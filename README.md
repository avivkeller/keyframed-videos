# keyframed-videos

**keyframed-videos** is a tool for generating animations based on gradients extracted from video frames. This tool processes video frames, applies color-based pixel analysis, and generates an HTML animation with CSS and keyframes. The animation mimics the color transitions present in the video, using linear gradients for each frame.

## Prerequisites

Before you can run this project, make sure you have the following installed:

- **Node.js**: This project requires Node.js.
- **FFmpeg**: FFmpeg is used to extract frames from the video.

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/avivkeller/keyframed-videos.git
   cd keyframed-videos
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Make sure you have FFmpeg installed and accessible in your PATH. If not, follow the installation guide at: [FFmpeg Installation](https://ffmpeg.org/download.html).

## Usage

1. Place your MP4 video file in the project directory (or modify the `videoPath` variable in the code to point to your video file).
2. Ensure that you have the `template.html` file in the `min` folder (as expected by the script).

3. Run the script to generate the CSS animation:

```console
$ node src/generate.mjs
Options:
      --version           Show version number                          [boolean]
  -i, --input             Path to input video or image folder[string] [required]
  -o, --output            Path to output HTML file
                                             [string] [default: "./output.html"]
  -t, --tempDir           Temporary directory for frames
                                              [string] [default: "./tempFrames"]
  -c, --concurrentFrames  Max concurrent frame processing tasks
                                                           [number] [default: 5]
  -f, --frameRate         Frame rate for processing       [number] [default: 30]
  -p, --precision         How precise the CSS percents should be. -1 for unlimit
                          ed (Default)                    [number] [default: -1]
  -h, --help              Show help                                    [boolean]
```

   - The script will process the video, extract frames, generate gradients, and create a CSS animation based on the video’s color data.
   - The generated HTML will be output to the console, with the necessary CSS for the animation.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to improve the project.

## Acknowledgements

- [FFmpeg](https://ffmpeg.org) - Used for video frame extraction.
- [Sharp](https://sharp.pixelplumbing.com) - Used for processing image data in frames.
