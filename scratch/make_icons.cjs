const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 512,
        height: 512,
        show: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const svgPath = path.resolve(__dirname, '../assets/wave.svg');
    const svgContent = fs.readFileSync(svgPath, 'utf8');

    // Ensure all SVG fills are solid rich black (#000000)
    const blackSvg = svgContent.replace(/fill="[^"]*"/g, 'fill="#000000"');

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
            canvas { display: block; }
        </style>
    </head>
    <body>
        <canvas id="c" width="512" height="512"></canvas>
        <script>
            const canvas = document.getElementById('c');
            const ctx = canvas.getContext('2d');

            // 100% Transparent background
            ctx.clearRect(0, 0, 512, 512);

            const svgImg = new Image();
            const svgBlob = new Blob([\`${blackSvg}\`], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(svgBlob);

            svgImg.onload = () => {
                // The actual wave content in the SVG is bounded between:
                // X: ~70 to ~560 (Width ~490)
                // Y: ~75 to ~730 (Height ~655)
                // We crop out the SVG empty margins and scale it to 100% full bleed!
                const srcX = 65;
                const srcY = 70;
                const srcW = 495;
                const srcH = 665;

                // Scale to fill the maximum possible 512x512 footprint
                const destH = 508;
                const destW = (srcW / srcH) * destH; // ~378px
                const destX = (512 - destW) / 2;
                const destY = 2;

                ctx.drawImage(svgImg, srcX, srcY, srcW, srcH, destX, destY, destW, destH);

                const dataUrl = canvas.toDataURL('image/png');
                const { ipcRenderer } = require('electron');
                ipcRenderer.send('icon-rendered', dataUrl);
            };
            svgImg.src = url;
        </script>
    </body>
    </html>
    `;

    const { ipcMain } = require('electron');
    ipcMain.once('icon-rendered', (event, dataUrl) => {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        const buf = Buffer.from(base64Data, 'base64');
        
        const outPngPath = path.resolve(__dirname, '../assets/icon.png');
        const outWavePng = path.resolve(__dirname, '../assets/wave.png');
        fs.writeFileSync(outPngPath, buf);
        fs.writeFileSync(outWavePng, buf);
        console.log('Successfully generated maximum-size transparent black assets/icon.png (512x512)');

        // Generate high-DPI Windows ICO file
        const icoHeader = Buffer.alloc(6);
        icoHeader.writeUInt16LE(0, 0); // Reserved
        icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
        icoHeader.writeUInt16LE(1, 4); // 1 image

        const icoDir = Buffer.alloc(16);
        icoDir.writeUInt8(0, 0); // 0 = 256 width
        icoDir.writeUInt8(0, 1); // 0 = 256 height
        icoDir.writeUInt8(0, 2); // Colors
        icoDir.writeUInt8(0, 3); // Reserved
        icoDir.writeUInt16LE(1, 4); // Color planes
        icoDir.writeUInt16LE(32, 6); // Bits per pixel
        icoDir.writeUInt32LE(buf.length, 8); // Image size in bytes
        icoDir.writeUInt32LE(22, 12); // Offset to image data

        const icoBuf = Buffer.concat([icoHeader, icoDir, buf]);
        const outIcoPath = path.resolve(__dirname, '../assets/icon.ico');
        fs.writeFileSync(outIcoPath, icoBuf);
        console.log('Successfully generated maximum-size transparent black assets/icon.ico');

        app.quit();
    });

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
});
