
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PROJECT_ROOT = process.cwd();
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const TARGET_DIRS = [SRC_DIR, PUBLIC_DIR];

const TEXT_EXTENSIONS = new Set([
    '.vue',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.html',
    '.css',
    '.scss',
    '.json',
    '.md',
]);

async function getFiles(dir) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        dirents.map((dirent) => {
            const res = path.resolve(dir, dirent.name);
            return dirent.isDirectory() ? getFiles(res) : res;
        })
    );
    return Array.prototype.concat(...files);
}

async function convertImages() {
    console.log('Starting PNG to WebP conversion...');

    const allFiles = [];
    for (const dir of TARGET_DIRS) {
        try {
            const files = await getFiles(dir);
            allFiles.push(...files);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(`Error reading directory ${dir}:`, err);
            }
        }
    }

    const pngFiles = allFiles.filter((file) => path.extname(file).toLowerCase() === '.png');

    if (pngFiles.length === 0) {
        console.log('No PNG files found.');
        return;
    }

    console.log(`Found ${pngFiles.length} PNG files. Converting...`);

    const conversions = [];

    for (const pngPath of pngFiles) {
        const p = path.parse(pngPath);
        const webpPath = path.join(p.dir, p.name + '.webp');

        try {
            await sharp(pngPath)
                .webp({
                    lossless: true
                })
                .toFile(webpPath);

            console.log(`Converted: ${p.base} -> ${p.name}.webp`);
            conversions.push({
                base: p.base,
                name: p.name,
                fullPath: pngPath
            });
        } catch (err) {
            console.error(`Failed to convert ${pngPath}:`, err);
        }
    }

    return conversions;
}

async function updateReferences(conversions) {
    if (!conversions || conversions.length === 0) return;

    console.log('Updating references in code...');

    const allFiles = [];
    for (const dir of TARGET_DIRS) {
        try {
            const files = await getFiles(dir);
            allFiles.push(...files);
        } catch (err) {
            //
        }
    }

    const textFiles = allFiles.filter(f => TEXT_EXTENSIONS.has(path.extname(f).toLowerCase()));

    for (const file of textFiles) {
        try {
            let content = await fs.readFile(file, 'utf-8');
            let changed = false;

            for (const { base, name } of conversions) {
                const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedBase, 'g');

                if (regex.test(content)) {
                    content = content.replace(regex, `${name}.webp`);
                    changed = true;
                }
            }

            if (changed) {
                await fs.writeFile(file, content, 'utf-8');
                console.log(`Updated references in: ${path.relative(PROJECT_ROOT, file)}`);
            }
        } catch (err) {
            console.error(`Error processing file ${file}:`, err);
        }
    }
}

async function main() {
    const conversions = await convertImages();
    await updateReferences(conversions);
    console.log('Done.');
}

main().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
