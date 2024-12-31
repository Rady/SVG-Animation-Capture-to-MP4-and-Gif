# SVG Animation Capture to MP4 and Gif

This Node.js application captures SVG animations and converts them to MP4 and GIF videos using a headless browser.

## Prerequisites

- Node.js
- FFmpeg (must be installed on your system)

## Installation

1. Install FFmpeg:
   ```bash
   # For macOS using Homebrew
   brew install ffmpeg
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

## Usage

Run the application by providing the path to your SVG file:
```bash
node index.js path/to/your/animation.svg
```

The application supports both local files and URLs:
- Local file: `node index.js ./animations/my-animation.svg`
- URL: `node index.js https://example.com/animation.svg`

The output will be saved as `filename_timestamp.mp4` and `filename_timestamp.gif` in the current directory.

## Configuration

You can modify these parameters in the code:
- `duration`: Length of the capture in milliseconds (default: 5000ms)
- Viewport size: Currently set to 1280x720
- FPS: Currently set to 30 frames per second
