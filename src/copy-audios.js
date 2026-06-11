import { G } from '@nuogz/pangu';

import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { parse as parsePath, resolve as resolvePath } from 'node:path';

import { ensureDirSync } from 'fs-extra/esm';

import { T, TS } from '../lib/i18n.js';

import { crc32, showID } from '../lib/utility.js';

const GG = G.where(T('save-audios:where'));


/**
 * @param {string[]} filesBank
 * @param {import('./entry/bnk/HIRCObject.js').HIRCObject[]} objectsBNKAll
 * @param {import('../bases.js').ExtractConfig} E
 */
export default function copyAudios$fileBank(filesBank, objectsBNKAll, E) {
	for(const fileBank of filesBank) {
		const pathParsedBank = parsePath(fileBank);
		const baseBank = pathParsedBank.base;

		const isSFX = baseBank.includes('sfx');

		const dirCacheAudioWAV = resolvePath(E.dirCacheAudio, `[wav]${baseBank}`);
		const dirCacheAudioWEM = resolvePath(E.dirCacheAudio, `[wem]${baseBank}`);

		if(!existsSync(dirCacheAudioWEM)) {
			GG.warnD(...TS('save-audios:exist-dir', { name: 'WEM', path: dirCacheAudioWEM }, 'not-exist'));

			continue;
		}

		// SFX: always copy WEM, optionally copy WAV when convertSFX is true
		if(isSFX) {
			const dirExport = resolvePath(E.dirExportSoundEffect, E.nameDirVoiceExport);
			ensureDirSync(dirExport);

			for(const fileAudio of readdirSync(dirCacheAudioWEM)) {
				const idAudio = parsePath(fileAudio).name;
				const srcWEM = resolvePath(dirCacheAudioWEM, `${idAudio}.wem`);

				if(!existsSync(srcWEM)) { GG.warnD(...TS('save-audios:exist-wem-source', { id: showID(idAudio) }, 'not-exist')); continue; }

				const hashWEM = crc32(readFileSync(srcWEM));
				copyFileSync(srcWEM, resolvePath(dirExport, `${hashWEM}.wem`));
			}

			// SFX: copy WAV files when convertSFX is enabled
			if(E.convertSFX && E.format == 'wav' && existsSync(dirCacheAudioWAV)) {
				const dirExportWAV = resolvePath(E.dirConversionSoundEffect, E.nameDirVoiceExport);
				ensureDirSync(dirExportWAV);

				for(const fileAudio of readdirSync(dirCacheAudioWAV)) {
					const idAudio = parsePath(fileAudio).name;
					const srcWEM = resolvePath(dirCacheAudioWEM, `${idAudio}.wem`);
					const srcWAV = resolvePath(dirCacheAudioWAV, `${idAudio}.wav`);

					if(!existsSync(srcWAV)) { continue; }

					const hashWEM = existsSync(srcWEM) ? crc32(readFileSync(srcWEM)) : idAudio;
					copyFileSync(srcWAV, resolvePath(dirExportWAV, `${hashWEM}.wav`));
				}
			}
		}
		else {
			// VO: copy WEM files
			const dirExportWEM = resolvePath(E.dirExportVoice, E.nameDirVoiceExport);
			ensureDirSync(dirExportWEM);

			for(const fileAudio of readdirSync(dirCacheAudioWEM)) {
				const idAudio = parsePath(fileAudio).name;
				const srcWEM = resolvePath(dirCacheAudioWEM, `${idAudio}.wem`);

				if(!existsSync(srcWEM)) { GG.warnD(...TS('save-audios:exist-wem-source', { id: showID(idAudio) }, 'not-exist')); continue; }

				const hashWEM = crc32(readFileSync(srcWEM));
				copyFileSync(srcWEM, resolvePath(dirExportWEM, `${hashWEM}.wem`));
			}

			// VO: copy WAV files (if format is wav and cache exists)
			if(E.format == 'wav' && existsSync(dirCacheAudioWAV)) {
				const dirExportWAV = resolvePath(E.dirConversionVoice, E.nameDirVoiceExport);
				ensureDirSync(dirExportWAV);

				for(const fileAudio of readdirSync(dirCacheAudioWAV)) {
					const idAudio = parsePath(fileAudio).name;
					const srcWEM = resolvePath(dirCacheAudioWEM, `${idAudio}.wem`);
					const srcWAV = resolvePath(dirCacheAudioWAV, `${idAudio}.wav`);

					if(!existsSync(srcWAV)) { continue; }

					const hashWEM = existsSync(srcWEM) ? crc32(readFileSync(srcWEM)) : idAudio;
					copyFileSync(srcWAV, resolvePath(dirExportWAV, `${hashWEM}.wav`));
				}
			}
		}
	}
}
