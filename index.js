const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');

function generateTimestamp() {
    const now = new Date();
    return now.toISOString()
        .replace(/-/g, '')     // Remove all hyphens
        .replace(/[:.]/g, '')  // Remove colons and dots
        .replace('T', '')      // Remove T
        .replace('Z', '');     // Remove Z
}

function getUniqueFilename(originalPath, extension) {
    const dir = path.dirname(originalPath);
    const basename = path.basename(originalPath, path.extname(originalPath));
    const timestamp = generateTimestamp();
    return path.join(dir, `${basename}_${timestamp}.${extension}`);
}

async function getAnimationDuration(page, repeat) {
    const duration = await page.evaluate((repeat) => {
        // Helper function to parse time values (s or ms)
        const parseTime = (timeStr) => {
            if (!timeStr) return 0;
            if (timeStr.endsWith('ms')) return parseFloat(timeStr);
            if (timeStr.endsWith('s')) return parseFloat(timeStr) * 1000;
            return parseFloat(timeStr);
        };

        // Get all animation elements
        const animationElements = document.querySelectorAll('animate, animateTransform, animateMotion, set');
        let maxDuration = 0;

        animationElements.forEach(element => {
            // Check dur attribute
            const durValue = parseTime(element.getAttribute('dur'));
            // Check begin attribute
            const beginValue = parseTime(element.getAttribute('begin')) || 0;
            // Check repeatCount and repeatDur
            const repeatCount = element.getAttribute('repeatCount');
            const repeatDur = parseTime(element.getAttribute('repeatDur'));

            let totalDuration = durValue + beginValue;

            // Handle repeat scenarios
            if (repeatCount === 'indefinite' || repeatDur) {
                totalDuration = repeatDur || (durValue * repeat); // Default to 3 iterations for indefinite
            } else if (!isNaN(repeatCount)) {
                totalDuration = durValue * parseFloat(repeatCount);
            }

            maxDuration = Math.max(maxDuration, totalDuration);
        });

        // Also check CSS animations
        const styleSheets = document.styleSheets;
        try {
            for (let sheet of styleSheets) {
                const rules = sheet.cssRules || sheet.rules;
                for (let rule of rules) {
                    if (rule.type === CSSRule.KEYFRAMES_RULE) {
                        const animatedElements = document.querySelectorAll(`*[style*="animation-name: ${rule.name}"]`);
                        animatedElements.forEach(element => {
                            const style = window.getComputedStyle(element);
                            const duration = parseFloat(style.animationDuration) * 1000;
                            const delay = parseFloat(style.animationDelay) * 1000;
                            const iterations = style.animationIterationCount === 'infinite' ? 3 : parseFloat(style.animationIterationCount);
                            const totalDuration = (duration * iterations) + delay;
                            maxDuration = Math.max(maxDuration, totalDuration);
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('Error checking CSS animations:', e);
        }

        return maxDuration || 5000; // Default to 5000ms if no animations found
    }, repeat);

    return duration;
}

async function getSVGDimensions(page) {
    const dimensions = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        if (!svg) return null;

        // Try to get dimensions from viewBox first
        const viewBox = svg.getAttribute('viewBox');
        if (viewBox) {
            const [x, y, width, height] = viewBox.split(' ').map(Number);
            if (!isNaN(width) && !isNaN(height)) {
                return { width, height };
            }
        }

        // Try width and height attributes
        let width = svg.getAttribute('width');
        let height = svg.getAttribute('height');

        // Convert percentage to pixels based on parent container
        if (width && width.endsWith('%')) {
            width = svg.parentElement.clientWidth * (parseFloat(width) / 100);
        } else if (width) {
            width = parseFloat(width);
        }

        if (height && height.endsWith('%')) {
            height = svg.parentElement.clientHeight * (parseFloat(height) / 100);
        } else if (height) {
            height = parseFloat(height);
        }

        // If explicit dimensions are found, use them
        if (!isNaN(width) && !isNaN(height)) {
            return { width, height };
        }

        // Fallback to getBBox() for intrinsic size
        const bbox = svg.getBBox();
        return {
            width: Math.ceil(bbox.width),
            height: Math.ceil(bbox.height)
        };
    });

    return dimensions || { width: 1280, height: 720 }; // Default dimensions if nothing is found
}

async function delay(time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
}

async function captureAnimation({svgUrl, outputPath, repeat, deviceScaleFactor, fps}) {

    // Create output directory if it doesn't exist
    const screenshotsDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir);
    }

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Navigate to SVG file
    await page.goto(svgUrl, { waitUntil: 'networkidle0' });

    // Get SVG dimensions
    const dimensions = await getSVGDimensions(page);
    console.log(`Detected SVG dimensions: ${dimensions.width}x${dimensions.height}`);

    if (deviceScaleFactor != 1) {
        console.log(`Using device scale factor: ${deviceScaleFactor}`);
    }

    // Set viewport to match SVG dimensions
    await page.setViewport({
        width: Math.ceil(dimensions.width),
        height: Math.ceil(dimensions.height),
        deviceScaleFactor: deviceScaleFactor  // Set back to 1 for consistent dimensions
    });

    // Get animation duration
    const duration = await getAnimationDuration(page, repeat);
    console.log(`Detected animation duration: ${duration}ms`);

    // Capture frames
    const frames = [];
    const totalFrames = Math.ceil((duration / 1000) * fps);
    const frameInterval = duration / totalFrames; // Calculate exact interval between frames
    
    console.log(`Capturing ${totalFrames} frames at ${fps} FPS...`);
    console.log(`Frame interval: ${frameInterval}ms`);
    
    await page.evaluate(() => {
        document.querySelectorAll('*').forEach(element => {
            const animations = element.getAnimations();
            animations.forEach(animation => {
                animation.cancel();
                animation.play();
            });
        });
    });

    let currentTime = 0;
    for (let i = 0; i < totalFrames; i++) {
        await page.evaluate((time) => {
            document.querySelectorAll('*').forEach(element => {
                const animations = element.getAnimations();
                animations.forEach(animation => {
                    animation.currentTime = time;
                    animation.pause(); // Pause animation at current time
                });
            });
        }, currentTime);

        await page.evaluate((time) => {
            const svg = document.querySelector('svg');
            if (svg && typeof svg.setCurrentTime === 'function') {
                svg.setCurrentTime(time / 1000);  // Move animation forward
            }
        }, currentTime);

        delay(50); // Allow some time for the frame to render

        const framePath = path.join(screenshotsDir, `frame-${i.toString().padStart(4, '0')}.png`);
        await page.screenshot({
            path: framePath,
            type: 'png',
            omitBackground: true
        });
        frames.push(framePath);
        
        currentTime += frameInterval;
        const progress = Math.round((i / totalFrames) * 100);
        process.stdout.write(`\rProgress: ${progress}%`);
    }

    await browser.close();

    // Generate unique filenames for both MP4 and GIF
    const mp4Path = getUniqueFilename(outputPath, 'mp4');
    const gifPath = getUniqueFilename(outputPath, 'gif');

    console.log(' ');
    
    console.log('------ Output Information ------');
    console.log('Generating MP4 and GIF outputs...');
    console.log(`MP4 output: ${mp4Path}`);
    console.log(`GIF output: ${gifPath}`);
    console.log('---------------------------------');
    console.log(' ');

    // Convert frames to video and GIF
    return Promise.all([
        // Generate GIF with simplified settings
        new Promise((resolve, reject) => {
            ffmpeg()
                .input(path.join(screenshotsDir, 'frame-%04d.png'))
                .inputFPS(fps)
                .output(gifPath)
                .outputOptions([
                    '-vf', [
                        `fps=${fps}`,
                        `scale=${dimensions.width * deviceScaleFactor}:${dimensions.height * deviceScaleFactor}:flags=lanczos`,
                        'split[s0][s1]',
                        '[s0]palettegen=max_colors=256[p]',
                        '[s1][p]paletteuse=dither=floyd_steinberg'
                    ].join(',')
                ])
                .on('start', (commandLine) => {
                    console.log('GIF Spawned FFmpeg with command:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('GIF Processing:', progress.percent, '% done');
                })
                .on('end', () => {
                    console.log('GIF conversion finished');
                    resolve();
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('GIF Error:', err);
                    console.error('FFmpeg Output:', stdout);
                    console.error('FFmpeg Error:', stderr);
                    reject(err);
                })
                .run();
        }),
        // Generate MP4 with more compatible settings
        new Promise((resolve, reject) => {
            ffmpeg()
                .input(path.join(screenshotsDir, 'frame-%04d.png'))
                .inputFPS(fps)
                .output(mp4Path)
                .videoCodec('libx264')
                .outputOptions([
                    '-pix_fmt yuv420p',
                    '-movflags +faststart',
                    '-preset medium',
                    '-crf 23',
                    '-profile:v main',
                    '-tune animation',
                    '-maxrate 2M',
                    '-bufsize 4M',
                    '-vf', `scale=${dimensions.width * deviceScaleFactor}:${dimensions.height * deviceScaleFactor}`
                ])
                .on('start', (commandLine) => {
                    console.log('MP4 Spawned FFmpeg with command:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('MP4 Processing:', progress.percent, '% done');
                })
                .on('end', () => {
                    console.log('MP4 conversion finished');
                    resolve();
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('MP4 Error:', err);
                    console.error('FFmpeg Output:', stdout);
                    console.error('FFmpeg Error:', stderr);
                    reject(err);
                })
                .run();
        })
    ]).then(() => {
        // Clean up screenshots
        frames.forEach(frame => fs.unlinkSync(frame));
        fs.rmdirSync(screenshotsDir);
        console.log('Conversion completed successfully!');
    }).catch((error) => {
        console.error('Conversion error:', error);
        // Clean up screenshots even if there's an error
        if (fs.existsSync(screenshotsDir)) {
            frames.forEach(frame => {
                if (fs.existsSync(frame)) {
                    fs.unlinkSync(frame);
                }
            });
            fs.rmdirSync(screenshotsDir);
        }
        throw error;
    });
}

async function main() {
    try {
        const argv = yargs
            .option('svg', {
                alias: 's',
                description: 'Path to the SVG file',
                type: 'string',
                demandOption: true, // svg path is required
            })
            .option('output', {
                alias: 'o',
                description: 'Path to save the output',
                type: 'string',
                default: process.cwd(), // Default to current working directory if not provided
            })
            .option('fps', {
                alias: 'f',
                description: 'Frames per second',
                type: 'number',
                default: 30, // Default to 30 FPS
            })
            .option('repeat', {
                alias: 'r',
                description: 'Number of times to repeat the animation',
                type: 'number',
                default: 3, // Default duration to 10 seconds
            })
            .option('scale', {
                alias: 'c',
                description: 'Device scale factor for rendering',
                type: 'number',
                default: 1, // Default duration to 10 seconds
            })
            .help()
            .alias('help', 'h')
            .argv;
        
        // Get the SVG path, output path, and other options from parsed arguments
        const svgPath = argv.svg;
        const outputBasePath = argv.output;
        const fps = argv.fps;
        const repeat = argv.repeat;
        const deviceScaleFactor = argv.scale;

        // Convert to file URL if it's a local path
        const svgUrl = svgPath.startsWith('http') ? svgPath : `file://${path.resolve(svgPath)}`;

        let finalOutputBasePath = outputBasePath;
        if (outputBasePath === process.cwd()) {
            // If no output path is provided, use the current working directory
            finalOutputBasePath = path.join(process.cwd(), path.basename(svgPath, '.svg'));
        }

        // Log the input information
        console.log('------ Input Information ------');
        console.log(`Input SVG: ${svgUrl}`);
        console.log(`Output Base Path: ${finalOutputBasePath}`);
        console.log(`FPS: ${fps}`);
        console.log(`Repeat animation ${repeat} times`);
        console.log(`Device Scale Factor: ${deviceScaleFactor}`);
        console.log('-------------------------------');
        console.log(' ');

        // Call the captureAnimation function with the parsed options
        await captureAnimation({
            svgUrl: svgUrl,  // this can be directly passed as a string if it's not an object
            outputPath: finalOutputBasePath,
            fps: fps,
            repeat: repeat,
            deviceScaleFactor: deviceScaleFactor
        });
    } catch (error) {
        console.error('Error capturing animation:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
