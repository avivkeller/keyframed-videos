import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import fs from 'fs';
import pLimit from 'p-limit';
import path from 'path';

// Configuration Constants
const videoPath = './my_video.mp4'; // Path to your MP4 file
const tempDir = './tempFrames'; // Directory to store frames temporarily
const maxConcurrentProcesses = 5; // Max concurrent processes for frame processing

// Ensure temp directory exists
fs.existsSync(tempDir) || fs.mkdirSync(tempDir);

function generateLinearGradient(colors, widthPerColor) {
  const mergedColors = colors.reduce((acc, color, i) => {
    if (i === 0 || color !== acc[acc.length - 1].color) {
      acc.push({ color, count: 1 });
    } else {
      acc[acc.length - 1].count++;
    }
    return acc;
  }, []);

  const totalWidth = mergedColors.reduce((sum, item) => sum + item.count, 0) * widthPerColor;

  let cumulativeWidth = 0;
  const stops = mergedColors.map(({ color, count }) => {
    const startPercentage = (cumulativeWidth / totalWidth) * 100;
    cumulativeWidth += count * widthPerColor;
    const endPercentage = (cumulativeWidth / totalWidth) * 100;
    return `#${color} ${startPercentage}%, #${color} ${endPercentage}%`;
  });

  return `linear-gradient(to right, ${stops.join(",")})`;
}

function minifyHex(hex) {
  return (hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5]) ? hex[0] + hex[2] + hex[4] : hex;
}

class Animation {
  constructor() {
    this.frames = [];
  }

  addColor(frame, x, y, color) {
    if (!this.frames[frame]) this.frames[frame] = [];
    if (!this.frames[frame][y]) this.frames[frame][y] = [];
    this.frames[frame][y][x] = minifyHex(color);
  }

  generateCSS(width, height, duration) {
    const positions = Array.from({ length: height }, (_, i) => `0 ${i}px`);
    const sizes = Array.from({ length: height }, () => `${width}px 1px`);
    
    const keyframes = this.frames.map((frame, idx) => {
      const percentage = (idx / this.frames.length) * 100;
      const backgroundImages = frame.map(colors => generateLinearGradient(colors, 1)).join(",");
      return `${percentage}% {background-position: var(--pos); background-image: ${backgroundImages};}`;
    });

    return `:root {--pos:${positions.join(",")};}
      .animation {
        height: ${height}px;
        width: ${width}px;
        animation: animation-keyframes ${duration}s infinite;
        background-repeat: no-repeat;
        background-size: ${sizes.join(', ')};
      }
      @keyframes animation-keyframes {${keyframes.join('')}}`;
  }
}

async function generateHTML(animation, width, height, duration) {
  try {
    const template = fs.readFileSync("./src/template.html", "utf-8");
    const css = animation.generateCSS(width, height, duration);
    console.log(template.replace("__CSS__", css));
  } catch (error) {
    console.error("Error generating HTML:", error.message);
  }
}

function getVideoDuration() {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) reject('Error retrieving video duration');
      else resolve(metadata.format.duration);
    });
  });
}

async function processFrames() {
  const animation = new Animation();
  const limit = pLimit(maxConcurrentProcesses);
  
  try {
    await extractFrames();
    const frameFiles = fs.readdirSync(tempDir).filter(file => file.endsWith('.png'));
    
    const processFramePromises = frameFiles.map((frameFile, index) =>
      limit(() => processFrame(path.join(tempDir, frameFile), index, animation))
    );

    await Promise.all(processFramePromises);
  } catch (err) {
    console.error('Error during frame extraction or processing:', err);
  }

  return animation;
}

async function extractFrames() {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(path.join(tempDir, 'frame-%04d.png'))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

let vWidth, vHeight;

async function processFrame(framePath, index, animation) {
  try {
    const { data, info } = await sharp(framePath).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    if (!vWidth || !vHeight) { vWidth = width; vHeight = height; }
    
    let pixelCount = 0;
    for (let i = 0; i < data.length; i += 3) {
      const color = `${data[i].toString(16).padStart(2, '0')}${data[i + 1].toString(16).padStart(2, '0')}${data[i + 2].toString(16).padStart(2, '0')}`;
      const y = Math.floor(pixelCount / width);
      const x = pixelCount % width;
      animation.addColor(index, x, y, color);
      pixelCount++;
    }

    fs.unlinkSync(framePath); // Optionally remove the temp file after processing
  } catch (error) {
    console.error(`Error processing frame ${index + 1}:`, error);
  }
}

(async function run() {
  try {
    console.error('Script started.');
    
    const duration = await getVideoDuration();
    console.error(`Video duration: ${duration} seconds`);
    
    const animation = await processFrames();
    console.error('Frame processing completed. Generating HTML...');
    
    await generateHTML(animation, vWidth, vHeight, duration);
    console.error('HTML generation completed.');
  } catch (error) {
    console.error('Error in script execution:', error);
  }
})();
