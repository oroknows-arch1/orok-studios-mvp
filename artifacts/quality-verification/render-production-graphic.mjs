import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {composeGraphicSvg} from '../../vendor/emradar-v3-authoritative/src/graphic-renderer.js';

const input=JSON.parse(await readFile(new URL('./production-indonesia-graphic-input.json',import.meta.url),'utf8'));
const {svg}=composeGraphicSvg(input);
await writeFile(new URL('./production-indonesia-graphic.svg',import.meta.url),svg,{mode:0o600});
await sharp(Buffer.from(svg)).png({compressionLevel:9}).toFile(fileURLToPath(new URL('./production-indonesia-graphic.png',import.meta.url)));
