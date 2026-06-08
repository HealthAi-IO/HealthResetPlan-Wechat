const storage = require('./storage');

const MEALS = [
  { summary: '燕麦粥 + 水煮蛋 + 牛奶', breakfast: ['燕麦粥', '水煮蛋', '低脂牛奶 200ml'], lunch: ['杂粮饭', '清蒸鱼 100g', '时蔬炒菜'], dinner: ['小米粥', '豆腐 150g', '绿叶菜'], snack: ['苹果 1 个'] },
  { summary: '全麦面包 + 低脂奶酪', breakfast: ['全麦面包 2 片', '低脂奶酪', '牛奶 200ml'], lunch: ['糙米饭', '鸡胸肉 120g', '西兰花'], dinner: ['蔬菜汤', '杂粮馒头 1 个'], snack: ['无糖酸奶'] },
  { summary: '杂粮馒头 + 豆浆', breakfast: ['杂粮馒头 1 个', '拌菜', '豆浆 300ml'], lunch: ['玉米 1 根', '豆腐炒蔬菜', '瘦肉 80g'], dinner: ['清淡面条', '时蔬'], snack: ['核桃 2 颗'] },
  { summary: '荞麦粥 + 煮蛋白', breakfast: ['荞麦粥', '煮蛋白 2 个', '低脂奶 200ml'], lunch: ['藜麦饭', '蒸虾 100g', '炒菠菜'], dinner: ['杂粮粥', '清蒸豆腐 150g'], snack: ['小番茄一把'] },
  { summary: '燕麦 + 蓝莓 + 牛奶', breakfast: ['燕麦 50g', '蓝莓 30g', '牛奶 250ml'], lunch: ['糙米 150g', '鱼肉 100g', '凉拌黄瓜'], dinner: ['冬瓜汤', '玉米饼 1 个'], snack: ['脱脂酸奶'] },
  { summary: '全麦面包 + 鸡蛋', breakfast: ['全麦面包 2 片', '鸡蛋 1 个', '无糖豆浆 300ml'], lunch: ['杂粮饭', '瘦猪肉 80g', '炒时蔬'], dinner: ['蒸红薯 150g', '青菜豆腐汤'], snack: ['橙子 1 个'] },
  { summary: '小米粥 + 茶叶蛋', breakfast: ['小米粥', '茶叶蛋 1 个', '凉拌蔬菜'], lunch: ['糙米饭', '三文鱼 100g', '芦笋'], dinner: ['清汤面', '清炒菠菜'], snack: ['坚果小包 15g'] },
];

const EXERCISES = [
  { type: '快走', duration: 30, intensity: '低强度', desc: '步速约 5 km/h，保持有氧状态' },
  { type: '有氧操', duration: 25, intensity: '中强度', desc: '跟视频操练，注意呼吸节奏' },
  { type: '瑜伽', duration: 30, intensity: '低强度', desc: '侧重拉伸与放松，改善柔韧' },
  { type: '骑行', duration: 30, intensity: '中强度', desc: '室内单车或户外平路，保持匀速' },
  { type: '游泳', duration: 30, intensity: '中强度', desc: '自由泳为主，匀速换气' },
  { type: '力量训练', duration: 25, intensity: '中强度', desc: '哑铃 + 自重，每组 12 次 × 3 组' },
  { type: '主动恢复', duration: 20, intensity: '低强度', desc: '散步 + 拉伸，促进肌肉修复' },
];

function generateWeekly() {
  const today = new Date();
  const list = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const date = d.toISOString().split('T')[0];
    const meal = MEALS[i % MEALS.length];
    const ex = EXERCISES[i % EXERCISES.length];

    list.push({ id: Date.now() + i,       date, type: 'meal',        summary: meal.summary,                    payload: meal });
    list.push({ id: Date.now() + i + 100, date, type: 'exercise',    summary: `${ex.type} ${ex.duration} 分钟`, payload: ex });
    list.push({ id: Date.now() + i + 200, date, type: 'measurement', summary: '测血压 + 称体重',                 payload: { items: ['空腹测血压，记录收缩压/舒张压', '早晨空腹称体重'] } });
  }
  storage.plans.saveAll(list);
  return list;
}

module.exports = { generateWeekly };
