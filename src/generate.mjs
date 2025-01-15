import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import cliProgress from "cli-progress";

/**
 * Main function to process video or image folder and generate animated HTML.
 * @param {Object} config - Configuration options.
 * @param {string} config.inputPath - Path to the input video or image folder.
 * @param {string} [config.outputHTMLPath='./output.html'] - Path to save the generated HTML file.
 * @param {string} [config.tempFrameDir='./tempFrames'] - Directory to store temporary frames.
 * @param {number} [config.maxConcurrentFrames=5] - Maximum concurrent frame processing tasks.
 * @param {number} [config.frameRate=30] - Frame rate for processing images. Does not apply to videos.
 * @param {number} [config.precision=-1] - How precise the CSS percents should be. -1 for unlimited.
 */
async function main({
  inputPath,
  outputHTMLPath = "./output.html",
  tempFrameDir = "./tempFrames",
  maxConcurrentFrames = 5,
  frameRate = 30,
  precision = -1,
}) {
  if (!fs.existsSync(inputPath)) {
    console.error("Input path does not exist.");
    return;
  }

  let videoWidth,
    videoHeight,
    videoDuration,
    deleteAfter = false;

  if (fs.lstatSync(inputPath).isDirectory()) {
    const imageFiles = fs
      .readdirSync(inputPath)
      .filter((file) => file.endsWith(".png"));
    if (imageFiles.length === 0) {
      console.error("No PNG files found in the folder.");
      return;
    }
    const sampleImage = path.join(inputPath, imageFiles[0]);
    const metadata = await sharp(sampleImage).metadata();
    videoWidth = metadata.width;
    videoHeight = metadata.height;
    videoDuration = imageFiles.length / frameRate;
    tempFrameDir = inputPath;
  } else {
    deleteAfter = true;
    fs.existsSync(tempFrameDir) || fs.mkdirSync(tempFrameDir);
    ({
      duration: videoDuration,
      width: videoWidth,
      height: videoHeight,
    } = await getVideoDetails(inputPath));
    await extractVideoFrames(inputPath, tempFrameDir);
  }

  const animationData = await processVideoFrames(
    tempFrameDir,
    maxConcurrentFrames,
    videoWidth,
    videoHeight
  );
  await createHTML(
    animationData,
    videoWidth,
    videoHeight,
    videoDuration,
    outputHTMLPath,
    precision
  );
  console.log("Processing completed.");
  deleteAfter && fs.rmSync(tempFrameDir, { recursive: true });
}

/**
 * Retrieve video duration, width, and height using ffprobe.
 * @param {string} videoFilePath - Path to the video file.
 * @returns {Promise<Object>} - Resolves with duration, width, and height.
 */
async function getVideoDetails(videoFilePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoFilePath, (err, metadata) => {
      if (err) {
        reject("Error retrieving video details");
      } else {
        const { duration } = metadata.format;
        const { width, height } =
          metadata.streams.find((stream) => stream.codec_type === "video") ||
          {};
        resolve({ duration, width, height });
      }
    });
  });
}

/**
 * Extract frames from a video and save them as images.
 * @param {string} videoFilePath - Path to the video file.
 * @param {string} frameOutputDir - Directory to save the extracted frames.
 * @returns {Promise<void>} - Resolves when extraction is complete.
 */
async function extractVideoFrames(videoFilePath, frameOutputDir) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoFilePath)
      .output(path.join(frameOutputDir, "frame-%04d.png"))
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

/**
 * Class to store and generate CSS for animation frames.
 */
class AnimationData {
  constructor() {
    this.frames = [];
  }

  /**
   * Add color data for a specific frame and pixel position.
   * @param {number} frameIndex - Frame index.
   * @param {number} x - X-coordinate of the pixel.
   * @param {number} y - Y-coordinate of the pixel.
   * @param {string} colorHex - Hexadecimal color value.
   */
  addFrameColor(frameIndex, x, y, colorHex) {
    if (!this.frames[frameIndex]) this.frames[frameIndex] = [];
    if (!this.frames[frameIndex][y]) this.frames[frameIndex][y] = [];
    this.frames[frameIndex][y][x] = minimizeHexColor(colorHex);
  }

  /**
   * Generate CSS for the animation based on frame data.
   * @param {number} animationWidth - Width of the animation.
   * @param {number} animationHeight - Height of the animation.
   * @param {number} animationDuration - Duration of the animation in seconds.
   * @param {number} [precision=-1] - How many decimal places to use in percents, -1 for unlimited
   * @returns {string} - Generated CSS string.
   */
  generateCSS(
    animationWidth,
    animationHeight,
    animationDuration,
    precision = -1
  ) {
    const rowPositions = Array.from(
      { length: animationHeight },
      (_, i) => `0 ${i}px`
    );
    const rowSizes = Array.from(
      { length: animationHeight },
      () => `${animationWidth}px 1px`
    );

    const keyframeProgressBar = new cliProgress.SingleBar(
      {
        format:
          "Generating keyframes [{bar}] {percentage}% | {value}/{total} keyframes",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    );

    keyframeProgressBar.start(this.frames.length);

    let lastFrameString = "";
    const keyframes = this.frames.map((frame, index) => {
      keyframeProgressBar.increment(1);
      let percentage = (index / this.frames.length) * 100;
      if (precision >= 0) {
        percentage = percentage.toFixed(precision);
        const next = ((index + 1) / this.frames.length) * 100;
        if (next.toFixed(precision) === percentage) return "";
        percentage = parseFloat(percentage);
      }
      let frameString = frame.join("");

      if (frameString === lastFrameString) return "";

      lastFrameString = frameString;
      const backgroundImages = frame
        .map((colors) => createLinearGradient(colors, 1, precision))
        .join(",");

      return `${percentage}%{--a:${backgroundImages}}`;
    });

    keyframeProgressBar.stop();

    return (
      `.animation{height:${animationHeight}px;width:${animationWidth}px;` +
      `animation:animation-frames ${animationDuration}s infinite;` +
      `background-repeat:no-repeat;background-image:var(--a);` +
      `background-size:${rowSizes.join(
        ","
      )};background-position:${rowPositions.join(",")}` +
      `}@keyframes animation-frames{${keyframes.join("")}}`
    );
  }
}

/**
 * Process frames in a directory and create animation data.
 * @param {string} frameDir - Directory containing frame images.
 * @param {number} maxConcurrentFrames - Maximum number of concurrent processing tasks.
 * @param {number} frameWidth - Width of each frame.
 * @returns {Promise<AnimationData>} - Resolves with animation data.
 */
async function processVideoFrames(frameDir, maxConcurrentFrames, frameWidth) {
  const animationData = new AnimationData();
  const limitConcurrency = pLimit(maxConcurrentFrames);
  const frameFiles = fs
    .readdirSync(frameDir)
    .filter((file) => file.endsWith(".png"));

  const frameProgressBar = new cliProgress.SingleBar(
    {
      format:
        "Processing frames [{bar}] {percentage}% | {value}/{total} frames",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  frameProgressBar.start(frameFiles.length, 0);

  const frameProcessingPromises = frameFiles.map((frameFile, frameIndex) =>
    limitConcurrency(() =>
      processFrameData(
        path.join(frameDir, frameFile),
        frameIndex,
        animationData,
        frameWidth
      ).then(() => frameProgressBar.increment())
    )
  );

  await Promise.all(frameProcessingPromises);
  frameProgressBar.stop();
  return animationData;
}

/**
 * Process an individual frame image and extract color data.
 * @param {string} frameFilePath - Path to the frame image.
 * @param {number} frameIndex - Index of the frame.
 * @param {AnimationData} animationData - Animation data instance to store extracted color data.
 * @param {number} frameWidth - Width of the frame.
 * @returns {Promise<void>} - Resolves when processing is complete.
 */
async function processFrameData(
  frameFilePath,
  frameIndex,
  animationData,
  frameWidth
) {
  const { data } = await sharp(frameFilePath)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let pixelIndex = 0;

  for (let i = 0; i < data.length; i += 3) {
    const colorHex = `${data[i].toString(16).padStart(2, "0")}${data[i + 1]
      .toString(16)
      .padStart(2, "0")}${data[i + 2].toString(16).padStart(2, "0")}`;
    const y = Math.floor(pixelIndex / frameWidth);
    const x = pixelIndex % frameWidth;
    animationData.addFrameColor(frameIndex, x, y, colorHex);
    pixelIndex++;
  }
}

/**
 * Create a linear gradient string from an array of colors.
 * @param {string[]} colorArray - Array of hexadecimal color values.
 * @param {number} widthPerColor - Width of each color in the gradient.
 * @param {number} percision - How precise the percents should be
 * @returns {string} - CSS linear gradient string.
 */
function createLinearGradient(colorArray, widthPerColor, percision = -1) {
  const mergedColors = colorArray.reduce((acc, color, i) => {
    if (i === 0 || color !== acc[acc.length - 1].color) {
      acc.push({ color, count: 1 });
    } else {
      acc[acc.length - 1].count++;
    }
    return acc;
  }, []);

  const totalWidth =
    mergedColors.reduce((sum, item) => sum + item.count, 0) * widthPerColor;

  let cumulativeWidth = 0;
  let stops;
  if (mergedColors.length === 1) {
    const color = "#" + mergedColors[0].color;
    stops = [color, color];
  } else {
    stops = mergedColors.map(({ color, count }) => {
      let startPercentage = (cumulativeWidth / totalWidth) * 100;
      if (percision >= 0)
        startPercentage = parseFloat(startPercentage.toFixed(percision));
      cumulativeWidth += count * widthPerColor;
      let endPercentage = (cumulativeWidth / totalWidth) * 100;
      if (percision >= 0)
        endPercentage = parseFloat(endPercentage.toFixed(percision));
      let code = `#${color} ${asPercent(startPercentage)}`;
      if (endPercentage !== 100) code += ` ${asPercent(endPercentage)}`;
      return code;
    });
  }

  return `linear-gradient(90deg,${stops.join(",")})`;
}

/**
 * Minimize a hexadecimal color string.
 * @param {string} hexColor - Hexadecimal color string.
 * @returns {string} - Minimized hexadecimal color string.
 */
function minimizeHexColor(hexColor) {
  return hexColor[0] === hexColor[1] &&
    hexColor[2] === hexColor[3] &&
    hexColor[4] === hexColor[5]
    ? hexColor[0] + hexColor[2] + hexColor[4]
    : hexColor;
}

/**
 * Minimize a CSS percentage.
 * @param {string} pcnt - Percentage.
 * @returns {string} - Minimized percentage.
 */
function asPercent(pcnt) {
  return pcnt == 0 ? pcnt : `${pcnt}%`;
}

/**
 * Generate an HTML file with the animation and save it to a specified path.
 * @param {AnimationData} animationData - Animation data containing frame information.
 * @param {number} width - Width of the animation.
 * @param {number} height - Height of the animation.
 * @param {number} duration - Duration of the animation in seconds.
 * @param {string} outputHTMLPath - Path to save the generated HTML file.
 * @param {number} [precision=-1] - How many decimal places to use in the CSS
 * @returns {Promise<void>} - Resolves when HTML generation is complete.
 */
async function createHTML(
  animationData,
  width,
  height,
  duration,
  outputHTMLPath,
  precision = -1
) {
  console.log("Generating HTML...");
  try {
    const templateContent = fs.readFileSync("./src/template.html", "utf-8");
    const generatedCSS = animationData.generateCSS(
      width,
      height,
      duration,
      precision
    );
    fs.writeFileSync(
      outputHTMLPath,
      templateContent.replace("__CSS__", generatedCSS)
    );
  } catch (error) {
    console.error("Error generating HTML:", error.message);
  }
}

// Parse CLI arguments
const argv = yargs(hideBin(process.argv))
  .option("input", {
    alias: "i",
    description: "Path to input video or image folder",
    type: "string",
    demandOption: true,
  })
  .option("output", {
    alias: "o",
    description: "Path to output HTML file",
    type: "string",
    default: "./output.html",
  })
  .option("tempDir", {
    alias: "t",
    description: "Temporary directory for frames",
    type: "string",
    default: "./tempFrames",
  })
  .option("concurrentFrames", {
    alias: "c",
    description: "Max concurrent frame processing tasks",
    type: "number",
    default: 5,
  })
  .option("frameRate", {
    alias: "f",
    description: "Frame rate for processing",
    type: "number",
    default: 30,
  })
  .option("precision", {
    alias: "p",
    description:
      "How precise the CSS percents should be. -1 for unlimited (Default)",
    type: "number",
    default: -1,
  })
  .help()
  .alias("help", "h").argv;

// Execute main function with CLI arguments
main({
  inputPath: argv.input,
  outputHTMLPath: argv.output,
  tempFrameDir: argv.tempDir,
  maxConcurrentFrames: argv.concurrentFrames,
  frameRate: argv.frameRate,
  precision: argv.precision,
});
