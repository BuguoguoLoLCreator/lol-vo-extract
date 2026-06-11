import { G } from '@nuogz/pangu';

import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { ensureDirSync } from 'fs-extra/esm';

import { pad0, showID, crc32 } from '../lib/utility.js';
import { champions$lang } from '../lib/database.js';

import { HIRCContainer, HIRCEvent, HIRCSwitch, HIRCSound } from './entry/bnk/HIRCObject.js';

const GG = G.where('[to-i18n] Save Event');

const keysUseless = [
	'_cast',
	'cast',
];

const convertEventNameToTitle = (name, mapsTitleEvent$name) => {
	let nameFormat = name.toLowerCase().replace(/[235]d/g, '');

	const trans = mapsTitleEvent$name.reduce((acc, [key, nameFriendly]) => {
		if(key instanceof RegExp && key.test(nameFormat)) {
			nameFormat = nameFormat.replace(key, '');

			acc.push(nameFriendly);
		}
		else if(typeof key == 'string' && nameFormat.includes(key)) {
			nameFormat = nameFormat.replace(key, '');

			acc.push(nameFriendly);
		}

		return acc;
	}, []).filter(t => t);

	if(nameFormat &&
		!keysUseless.reduce((acc, key) => acc + nameFormat.includes(key), 0)
	) { trans.push(''); }

	return trans.join(':');
};

/**
 * 递归获取音频ID列表
 * @param {import('./entry/bnk/HIRCObject.js').HIRCObject} objectParsed
 * @param {import('./entry/bnk/HIRCObject.js').HIRCObject[]} objectsAll
 * @param {import('./entry/bnk/HIRCObject.js').HIRCAction} action
 * @returns {number[]}
 */
const groupActionChildAudioIDs = (objectParsed, objectsAll, action) => {
	const idsAudio = [];

	if(objectParsed instanceof HIRCSound) {
		idsAudio.push(objectParsed.idAudio);
	}
	else if(objectParsed instanceof HIRCContainer) {
		const objects = [...new Set([
			...objectsAll.filter(object => objectParsed.idsChildren.includes(object.id)),
			...objectParsed.switches ?? [],
		])];

		for(const object of objects) {
			idsAudio.push(...groupActionChildAudioIDs(object, objectsAll, action));
		}
	}
	else if(objectParsed instanceof HIRCSwitch) {
		const objects = objectsAll.filter(object => objectParsed.idsChildren.includes(object.id));

		for(const object of objects) {
			idsAudio.push(...groupActionChildAudioIDs(object, objectsAll, action));
		}
	}
	else if(!objectParsed) {
		GG.warnD(`unknown-action-object: ${showID(action.id)}, ${showID(action.idTarget)}`);
	}
	else if(objectParsed) {
		GG.warnD(`unknown-action-object-type: ${showID(action.id)}, ${showID(action.idTarget)}, ${Object.getPrototypeOf(objectParsed).constructor.name}`);
	}

	return idsAudio;
};

/**
 * 获取音频ID对应的WEM哈希值
 * @param {number} audioID
 * @param {import('../bases.js').ExtractConfig} E
 * @returns {string}
 */
const getWEMHash = (audioID, E) => {
	const dirCacheAudio = E.dirCacheAudio;

	try {
		const items = readdirSync(dirCacheAudio);
		for(const item of items) {
			if(item.startsWith('[wem]')) {
				const dirCacheAudioWEM = resolvePath(dirCacheAudio, item);
				const srcWEM = resolvePath(dirCacheAudioWEM, `${audioID}.wem`);

				if(existsSync(srcWEM)) {
					try {
						return crc32(readFileSync(srcWEM));
					} catch(e) {
						GG.warnD(`Failed to read WEM file ${srcWEM}: ${e.message}`);
						return '';
					}
				}
			}
		}
	} catch(e) {
		GG.warnD(`Failed to read cache directory: ${e.message}`);
		return '';
	}

	return '';
};

/**
 * @param {import('./entry/bnk/HIRCObject.js').HIRCObject[]} objectsBNKAll
 * @param {import('../bases.js').ExtractConfig} E
 * @param {string} dirExport - 导出目录
 * @param {Array<{file: string, start: number, end: number}>} fileRanges - 每个BNK文件的对象范围
 * @param {boolean} isSFX - 是否导出SFX事件
 */
export default async function saveEvent(objectsBNKAll, E, dirExport, fileRanges, isSFX) {
	/** @type {Array<[string, string]>} */
	const mapsTitleEvent$name = [];

	if(E.mode == 'skin') {
		for(let i = 1; i < 8; i++) {
			mapsTitleEvent$name.push([E.slot + 'BasicAttack' + i, '普攻']);
			mapsTitleEvent$name.push([E.slot + 'CritAttack' + i, '暴击']);
		}
		mapsTitleEvent$name.push([E.slot + 'BasicAttack', '普攻']);
		mapsTitleEvent$name.push([E.slot + 'CritAttack', '暴击']);

		for(const key in E.champion.spells) {
			const keyUppser = key.toUpperCase();
			const textUsage = keyUppser == 'P' ? '触发' : '使用';
			const textSkill = `${textUsage}:${keyUppser}${E.champion.spells[key]}`;

			mapsTitleEvent$name.push([`${E.slot}${keyUppser}`, textSkill]);
			mapsTitleEvent$name.push([`Spell${keyUppser}`, textSkill]);
		}
	}

	try {
		mapsTitleEvent$name.push(...(await import(`../data/friendly-name/${E.lang}.js`)).default);
	}
	catch { void 0; }

	Object.values(champions$lang[E.lang]).forEach(champion => {
		Object.values(champion.skins).filter(skin => typeof skin == 'object').forEach(skin => {
			mapsTitleEvent$name.push([`${champion.slot}Skin${String(skin.id).padStart(2, '0')}`, `皮肤:${skin.name}`]);
		});

		mapsTitleEvent$name.push([new RegExp(`${champion.slot}Skin\\d+`, 'i'), `皮肤: ${champion.name}`]);
		mapsTitleEvent$name.push([champion.slot, `英雄:${champion.name}`]);
	});

	mapsTitleEvent$name.forEach(map => (
		map[0] = typeof map[0] == 'string' ? map[0].trim().toLowerCase() : map[0],
		map[1] = map[1].trim()
	));

	/** @type {Object<string, any>} */
	const eventData = {};

	// Filter events based on file ranges (VO or SFX)
	const relevantRanges = fileRanges.filter(range => isSFX ? range.file.includes('sfx') : !range.file.includes('sfx'));
	const relevantIndices = new Set();
	for(const range of relevantRanges) {
		for(let i = range.start; i < range.end; i++) {
			relevantIndices.add(i);
		}
	}

	for(const event of objectsBNKAll.filter((object, index) => object instanceof HIRCEvent && relevantIndices.has(index))) {
		const eventName = event.name;
		const nameEventShort = eventName
			.replace(/^play_vo_/i, '')
			.replace(new RegExp(`^${E.champion?.slot}${E.skin?.id ? `skin${pad0(E.skin.id, 2)}` : ''}_`, 'i'), '');

		// 获取该事件关联的所有音频ID
		const audioIDs = [];
		for(const actionID of event.idsAction) {
			/** @type {HIRCAction} */
			const action = objectsBNKAll.find(object => object.id == actionID);
			const objectAction = objectsBNKAll.find(object => object.id == action.idTarget);
			audioIDs.push(...groupActionChildAudioIDs(objectAction, objectsBNKAll, action));
		}

		// 转换为WEM哈希格式
		const voices = [...new Set(audioIDs)]
			.map(id => getWEMHash(id, E))
			.filter(hash => hash !== '');

		eventData[eventName] = {
			name: convertEventNameToTitle(nameEventShort, mapsTitleEvent$name),
			voices: voices
		};
	}

	ensureDirSync(dirExport);

	// 检查eventData是否为空，如果为空则跳过保存
	if(Object.keys(eventData).length === 0) {
		GG.infoD(`无需处理事件，跳过 ${E.mode == 'skin' ? `${E.champion.name} (${E.skin.name})` : E.slot}`);
		return;
	}

	// 生成文件名
	const fileName = E.mode == 'skin' ?
		`${pad0(E.champion.id)}${pad0(E.skin.id)}.json` :
		`${E.slot}.json`;

	writeFileSync(resolvePath(dirExport, fileName), JSON.stringify(eventData, null, 2));
}
