/**
 * Runcom 配置生成工具
 * 整合多种 runcom 生成功能：
 * 1. 全英雄全皮肤
 * 2. 单英雄全皮肤
 * 3. 按版本获取新增皮肤
 * 4. 显示英雄列表
 * 5. 全英雄默认皮肤
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolvePath(__dirname, '..');

// ==================== 常量 ====================

/** slot 替换表：本地数据库 slot → runcom 输出 slot */
const SLOT_SUBSTITUTIONS = {
	wukong: 'monkeyking',
};

/** 应用 slot 替换 */
const applySlot = (slot) => SLOT_SUBSTITUTIONS[slot] || slot;

// ==================== 工具函数 ====================

/**
 * 创建命令行交互接口
 */
function createRL() {
	return createInterface({
		input: process.stdin,
		output: process.stdout
	});
}

/**
 * 提问并等待用户输入
 */
function askQuestion(rl, question) {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			resolve(answer.trim());
		});
	});
}

/**
 * 加载英雄数据库
 */
function loadChampionData(lang = 'zh_cn') {
	const dataPath = resolvePath(PROJECT_DIR, `data/base/${lang}.json`);

	if(!existsSync(dataPath)) {
		console.error(`❌ 英雄数据不存在: ${dataPath}`);
		console.log('💡 请先运行: node script/3-convert-base.js');
		return null;
	}

	try {
		return JSON.parse(readFileSync(dataPath, 'utf8'));
	} catch(e) {
		console.error(`❌ 加载英雄数据失败: ${e.message}`);
		return null;
	}
}

/**
 * 保存 runcom 配置
 */
function saveRuncom(runcoms, fileName) {
	const configDir = resolvePath(PROJECT_DIR, 'config');
	const filePath = resolvePath(configDir, fileName);
	const content = JSON.stringify(runcoms, null, '\t');
	writeFileSync(filePath, content);
	return filePath;
}

// ==================== 生成器函数 ====================

/**
 * 生成全英雄全皮肤配置
 */
function generateAllChampions(championsData, profile = 'pbe-zh') {
	const runcoms = [];

	Object.values(championsData).forEach(champion => {
		Object.keys(champion.skins).forEach(skinId => {
			const skin = champion.skins[skinId];
			// 跳过炫彩皮肤（数字类型表示指向主皮肤）
			if(typeof skin === 'number') return;

			runcoms.push(`${applySlot(champion.slot)}|${skinId}|${skin.name}|${profile}`);
		});
	});

	return runcoms;
}

/**
 * 生成全英雄默认皮肤配置（只有 skin id 0）
 */
function generateAllChampionsDefaultSkin(championsData, profile = 'pbe-zh') {
	const runcoms = [];

	Object.values(championsData).forEach(champion => {
		// 只获取默认皮肤 (skin id 0)
		const defaultSkin = champion.skins['0'] || champion.skins[0];
		if(defaultSkin && typeof defaultSkin !== 'number') {
			runcoms.push(`${applySlot(champion.slot)}|0|${defaultSkin.name}|${profile}`);
		}
	});

	return runcoms;
}

/**
 * 生成单英雄全皮肤配置
 */
function generateChampionSkins(champion, profile = 'pbe-zh') {
	const runcoms = [];

	Object.keys(champion.skins).forEach(skinId => {
		const skin = champion.skins[skinId];
		// 跳过炫彩皮肤
		if(typeof skin === 'number') return;

		runcoms.push(`${applySlot(champion.slot)}|${skinId}|${skin.name}|${profile}`);
	});

	return runcoms;
}

/**
 * 查找英雄（支持 ID、名称、slot 搜索）
 */
function findChampion(championsData, query) {
	const queryLower = query.toLowerCase();

	// 按 ID 查找
	if(championsData[query]) {
		return championsData[query];
	}

	// 按名称或 slot 查找
	for(const champion of Object.values(championsData)) {
		if(champion.name.toLowerCase().includes(queryLower) ||
			champion.slot.toLowerCase() === queryLower) {
			return champion;
		}
	}

	return null;
}

/**
 * 显示英雄列表
 */
function showChampionList(championsData) {
	console.log('\n📋 英雄列表:');
	console.log('─'.repeat(60));
	console.log('ID'.padStart(4) + ' │ ' + '名称'.padEnd(12) + ' │ ' + '标识符'.padEnd(15) + ' │ 皮肤数');
	console.log('─'.repeat(60));

	const champions = Object.entries(championsData)
		.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

	for(const [id, champion] of champions) {
		const skinCount = Object.values(champion.skins)
			.filter(s => typeof s !== 'number').length;
		console.log(
			id.padStart(4) + ' │ ' +
			champion.name.padEnd(12) + ' │ ' +
			champion.slot.padEnd(15) + ' │ ' +
			String(skinCount).padStart(3)
		);
	}
	console.log('─'.repeat(60));
}

/**
 * 获取新增皮肤（通过 CDragon API）
 */
async function getNewSkins(compareVersion = 'latest', profile = 'pbe-zh') {
	const CDRAGON = 'https://communitydragon.buguoguo.cn';

	const fetchJSON = async (url) => {
		const response = await fetch(url);
		if(!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.json();
	};

	const dataURL = (path, patch) =>
		`${CDRAGON}/${patch}/plugins/rcp-be-lol-game-data/global/zh_cn${path}?t=${Date.now()}`;

	console.log(`\n🔍 正在获取 PBE 和 ${compareVersion} 版本数据...`);

	try {
		// 获取 PBE 数据
		const [pbeChampions, pbeSkins] = await Promise.all([
			fetchJSON(dataURL('/v1/champion-summary.json', 'pbe')),
			fetchJSON(dataURL('/v1/skins.json', 'pbe'))
		]);
		console.log('✓ PBE 数据加载完成');

		// 获取对比版本数据
		const compareSkins = await fetchJSON(dataURL('/v1/skins.json', compareVersion));
		console.log(`✓ ${compareVersion} 版本数据加载完成`);

		// 处理阶段皮肤
		const processSkins = (skins) => {
			Object.keys(skins).forEach(id => {
				const skin = skins[id];
				if(skin.questSkinInfo) {
					skin.questSkinInfo.tiers.forEach(tier => {
						skins[tier.id.toString()] = { ...skin, ...tier };
					});
				}
			});
			return skins;
		};

		processSkins(pbeSkins);
		processSkins(compareSkins);

		// 找出新增皮肤
		const compareSkinIds = new Set(Object.keys(compareSkins));
		const newSkinIds = Object.keys(pbeSkins).filter(id => !compareSkinIds.has(id));

		if(newSkinIds.length === 0) {
			console.log('\n📭 没有发现新增皮肤');
			return [];
		}

		// 创建英雄映射
		const championMap = {};
		pbeChampions.filter(c => c.id !== -1).forEach(c => {
			const key = c.alias.toLowerCase();
			// 处理特殊命名
			const SUBSTITUTIONS = { monkeyking: 'wukong' };
			championMap[c.id] = { ...c, key: SUBSTITUTIONS[key] || key };
		});

		// 生成 runcom 配置
		const runcoms = [];
		const newSkinsInfo = [];

		newSkinIds.forEach(skinId => {
			const skin = pbeSkins[skinId];
			const skinIdNum = parseInt(skinId);
			const championId = Math.floor(skinIdNum / 1000);
			const skinIdInChampion = skinIdNum % 1000;
			const champion = championMap[championId];

			if(!champion) {
				console.warn(`⚠ 找不到英雄 ID ${championId}`);
				return;
			}

			runcoms.push(`${applySlot(champion.key)}|${skinIdInChampion}|${skin.name}|${profile}`);
			newSkinsInfo.push({
				championName: champion.name,
				skinName: skin.name,
				skinId: skinIdInChampion,
				isNew: skinIdInChampion === 0
			});
		});

		// 显示新增皮肤
		console.log(`\n🆕 发现 ${newSkinsInfo.length} 个新增皮肤:`);
		newSkinsInfo.forEach(info => {
			const tag = info.isNew ? ' [新英雄]' : '';
			console.log(`  • ${info.championName} - ${info.skinName}${tag}`);
		});

		return runcoms;

	} catch(e) {
		console.error(`❌ 获取数据失败: ${e.message}`);
		return [];
	}
}

// ==================== 主菜单 ====================

async function main() {
	console.log('╔════════════════════════════════════════╗');
	console.log('║   lol-vo-extract - Runcom 生成器       ║');
	console.log('╚════════════════════════════════════════╝\n');

	const rl = createRL();

	try {
		console.log('请选择生成模式:');
		console.log('  1. 全英雄全皮肤');
		console.log('  2. 单英雄全皮肤');
		console.log('  3. 新增皮肤（通过 CDragon 对比版本）');
		console.log('  4. 显示英雄列表');
		console.log('  5. 全英雄默认皮肤（仅原画）');
		console.log('  0. 退出\n');

		const mode = await askQuestion(rl, '请输入选项 [0-5]: ');

		switch(mode) {
			case '1': {
				const championsData = loadChampionData();
				if(!championsData) break;

				const profile = await askQuestion(rl, '配置档案 (默认 pbe-zh): ') || 'pbe-zh';
				const runcoms = generateAllChampions(championsData, profile);

				const filePath = saveRuncom(runcoms, 'runcom.all-champions.jsonc');
				console.log(`\n✅ 已生成 ${runcoms.length} 个配置`);
				console.log(`📁 保存到: ${filePath}`);
				break;
			}

			case '2': {
				const championsData = loadChampionData();
				if(!championsData) break;

				const query = await askQuestion(rl, '请输入英雄 ID/名称/标识符: ');
				const champion = findChampion(championsData, query);

				if(!champion) {
					console.log(`❌ 找不到英雄: ${query}`);
					console.log('💡 输入 4 查看英雄列表');
					break;
				}

				console.log(`\n🎮 ${champion.name} (${champion.slot})`);
				console.log('皮肤列表:');
				Object.entries(champion.skins).forEach(([id, skin]) => {
					if(typeof skin === 'number') return;
					console.log(`  • [${id.padStart(2, '0')}] ${skin.name}`);
				});

				const profile = await askQuestion(rl, '\n配置档案 (默认 pbe-zh): ') || 'pbe-zh';
				const runcoms = generateChampionSkins(champion, profile);

				const fileName = `runcom.${champion.slot.toLowerCase()}.jsonc`;
				const filePath = saveRuncom(runcoms, fileName);
				console.log(`\n✅ 已生成 ${runcoms.length} 个配置`);
				console.log(`📁 保存到: ${filePath}`);
				break;
			}

			case '3': {
				const compareVersion = await askQuestion(rl, '对比版本 (默认 latest): ') || 'latest';
				const profile = await askQuestion(rl, '配置档案 (默认 pbe-zh): ') || 'pbe-zh';

				const runcoms = await getNewSkins(compareVersion, profile);

				if(runcoms.length > 0) {
					const filePath = saveRuncom(runcoms, 'runcom.new-skins.jsonc');
					console.log(`\n✅ 已生成 ${runcoms.length} 个配置`);
					console.log(`📁 保存到: ${filePath}`);
				}
				break;
			}

			case '4': {
				const championsData = loadChampionData();
				if(championsData) {
					showChampionList(championsData);
				}
				break;
			}

			case '5': {
				const championsData = loadChampionData();
				if(!championsData) break;

				const profile = await askQuestion(rl, '配置档案 (默认 pbe-zh): ') || 'pbe-zh';
				const runcoms = generateAllChampionsDefaultSkin(championsData, profile);

				const filePath = saveRuncom(runcoms, 'runcom.default-skins.jsonc');
				console.log(`\n✅ 已生成 ${runcoms.length} 个配置（每英雄仅默认皮肤）`);
				console.log(`📁 保存到: ${filePath}`);
				break;
			}

			case '0':
			default:
				console.log('\n👋 再见!');
				break;
		}

	} finally {
		rl.close();
	}
}

// 运行
main().catch(console.error);
