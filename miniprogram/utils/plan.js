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

const GOAL_MAP = {
  '减脂降重': 'lose_weight',
  '控糖': 'lower_glucose',
  '控压': 'lower_bp',
  '降脂': 'lower_lipid',
  '综合调理': 'general'
};

const DIET_MAP = {
  '素食': 'vegetarian',
  '低盐低脂': 'light',
  '定制饮食': 'light',
  '普通饮食': 'normal'
};

const EXERCISE_BASE_MAP = {
  '久坐不动': 'none',
  '轻度活动': 'light',
  '中度活动': 'moderate',
  '高度活动': 'moderate'
};

function generateWeekly() {
  const today = new Date();
  const list = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const date = dateKey(d);
    const meal = MEALS[i % MEALS.length];
    const ex = EXERCISES[i % EXERCISES.length];

    list.push({ id: Date.now() + i,       date, type: 'meal',        summary: meal.summary,                    payload: meal });
    list.push({ id: Date.now() + i + 100, date, type: 'exercise',    summary: `${ex.type} ${ex.duration} 分钟`, payload: ex });
    list.push({ id: Date.now() + i + 200, date, type: 'measurement', summary: '测血压 + 称体重',                 payload: { items: ['空腹测血压，记录收缩压/舒张压', '早晨空腹称体重'] } });
  }
  storage.plans.saveAll(list);
  return list;
}

function buildAiPlanRequest(provider) {
  const prof = storage.profile.get() || {};
  const height = Number(prof.heightCm) || 0;
  const weight = Number(prof.weightKg) || 0;
  const bmi = height > 0 && weight > 0 ? Number((weight / Math.pow(height / 100, 2)).toFixed(1)) : 0;
  const bp = storage.indicators.latestByType('bp');
  const glucose = storage.indicators.latestByType('glucose');
  const lipid = storage.indicators.latestByType('lipid');

  const history = [
    prof.medicalHistory,
    prof.hasHypertension ? '高血压' : '',
    prof.hasDiabetes ? '糖尿病/血糖异常' : '',
    prof.hasHyperlipidemia ? '高血脂' : '',
    prof.hasCVD ? '心脑血管病史' : '',
    prof.hasObesity ? '肥胖' : '',
    prof.medicines || prof.medications ? `用药：${prof.medicines || prof.medications}` : ''
  ].filter(Boolean).join('；');

  return {
    ...(provider ? { provider } : {}),
    age: Number(prof.age) || 0,
    gender: prof.gender === '女' || prof.gender === 1 ? 'female' : 'male',
    heightCm: height,
    weightKg: weight,
    bmi,
    medicalHistory: history,
    recentBp: bp && bp.payload ? `${bp.payload.systolic}/${bp.payload.diastolic}` : '',
    recentGlucose: glucose && glucose.payload ? firstNumber(glucose.payload.mmol) : null,
    recentTc: lipid && lipid.payload ? firstNumber(lipid.payload.tc) : null,
    recentLdl: lipid && lipid.payload ? firstNumber(lipid.payload.ldl) : null,
    goal: GOAL_MAP[prof.goal] || prof.goal || 'general',
    dietPref: DIET_MAP[prof.dietPref] || prof.dietPref || 'normal',
    exerciseBase: EXERCISE_BASE_MAP[prof.activityLevel] || prof.exerciseBase || 'none'
  };
}

function applyAiPlanResult(result) {
  const plan = parseAiPlanJson(result && result.rawJson);
  const days = Array.isArray(plan.days) ? plan.days.filter(d => d && typeof d === 'object') : [];
  if (days.length !== 7) {
    throw new Error('AI 返回格式不完整，未能转换为 7 天计划');
  }

  const now = Date.now();
  const today = new Date();
  const provider = (result && result.provider) || 'ai';
  const keyFocus = text(plan.keyFocus);
  const targetCalories = number(plan.targetCalories);
  const list = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const date = dateKey(d);
    const day = days[i] || {};
    const diet = objectMap(day.diet);
    const exercise = objectMap(day.exercise);
    const reminders = stringList(day.reminders);

    const mealPayload = aiMealPayload(diet, keyFocus, targetCalories);
    const exercisePayload = aiExercisePayload(exercise);
    const measurementPayload = aiMeasurementPayload(reminders);

    list.push({
      id: `ai-${now}-${i}-meal`,
      date,
      type: 'meal',
      summary: mealPayload.summary,
      payload: mealPayload,
      aiProvider: provider,
      aiModel: 'ai-plan-json'
    });
    list.push({
      id: `ai-${now}-${i}-exercise`,
      date,
      type: 'exercise',
      summary: exercisePayload.summary,
      payload: exercisePayload,
      aiProvider: provider,
      aiModel: 'ai-plan-json'
    });
    list.push({
      id: `ai-${now}-${i}-measurement`,
      date,
      type: 'measurement',
      summary: measurementPayload.summary,
      payload: measurementPayload,
      aiProvider: provider,
      aiModel: 'ai-plan-json'
    });
  }

  storage.plans.saveAll(list);
  return {
    provider,
    summary: text(plan.summary),
    keyFocus,
    count: list.length
  };
}

function parseAiPlanJson(rawJson) {
  const raw = text(rawJson);
  if (!raw) return {};

  const candidates = [raw];
  if (raw.startsWith('```')) {
    const start = raw.indexOf('\n');
    const end = raw.lastIndexOf('```');
    if (start >= 0 && end > start) candidates.push(raw.slice(start + 1, end).trim());
  }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const decoded = JSON.parse(candidate);
      if (decoded && typeof decoded === 'object') return normalizePlanMap(decoded);
    } catch (e) {}
  }
  return {};
}

function normalizePlanMap(map) {
  if (Array.isArray(map.days)) return map;
  for (const key of ['plan', 'data', 'result', 'weeklyPlan']) {
    if (map[key] && typeof map[key] === 'object') {
      const nested = normalizePlanMap(map[key]);
      if (Array.isArray(nested.days)) return nested;
    }
  }
  for (const key of ['rawJson', 'content', 'text']) {
    if (typeof map[key] === 'string' && map[key].trim()) {
      const nested = parseAiPlanJson(map[key]);
      if (Array.isArray(nested.days)) return nested;
    }
  }
  return map;
}

function aiMealPayload(diet, keyFocus, targetCalories) {
  const breakfast = stringList(diet.breakfast);
  const lunch = stringList(diet.lunch);
  const dinner = stringList(diet.dinner);
  const snack = stringList(diet.snack);
  const notes = text(diet.notes);
  const summaryParts = [
    targetCalories ? `${targetCalories} kcal` : '',
    keyFocus,
    breakfast[0] || ''
  ].filter(Boolean);

  return {
    summary: notes || summaryParts.join('，') || '按 AI 建议完成今日饮食',
    ...(keyFocus ? { goalNote: keyFocus } : {}),
    ...(targetCalories ? { targetCalories } : {}),
    breakfast,
    lunch,
    dinner,
    snack
  };
}

function aiExercisePayload(exercise) {
  const type = text(exercise.type);
  const duration = number(exercise.durationMinutes);
  const intensity = text(exercise.intensity);
  const desc = text(exercise.description);
  const parts = [
    type,
    duration ? `${duration} 分钟` : '',
    intensity
  ].filter(Boolean);

  return {
    summary: parts.join(' · ') || desc || '按 AI 建议完成今日运动',
    ...(type ? { type } : {}),
    ...(duration ? { duration, durationMinutes: duration } : {}),
    ...(intensity ? { intensity } : {}),
    ...(desc ? { desc } : {}),
    items: desc ? [desc] : []
  };
}

function aiMeasurementPayload(reminders) {
  const items = reminders.length ? reminders : ['晨起空腹体重', '按需记录血压、血糖或今日不适'];
  return {
    summary: `今日 ${items.length} 项提醒`,
    items
  };
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function text(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.toLowerCase() === 'null' ? '' : s;
}

function number(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const n = Number(text(v));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function firstNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stringList(raw) {
  if (Array.isArray(raw)) return raw.map(text).filter(Boolean);
  const s = text(raw);
  if (!s) return [];
  return s.split(/[；;、/]/).map(text).filter(Boolean);
}

function objectMap(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

module.exports = {
  generateWeekly,
  buildAiPlanRequest,
  applyAiPlanResult,
  parseAiPlanJson
};
