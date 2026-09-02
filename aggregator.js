/**
 * ============================================================
 * aggregator.js — 数据聚合模块
 * ============================================================
 *
 * 职责：
 *   1. 按天聚合：以 begin_at（毫秒时间戳）转换为本地日期（YYYY-MM-DD）
 *   2. 按 model_category 分组：每天内再按模型类别分组
 *   3. 区分 Charged / Not Charged：cost > 0 为 Charged
 *   4. 计算汇总：总积分、总花费、日均积分、日均花费
 *   5. 计算每天小计：每天的总积分和总花费
 *
 * 输入：records 数组（来自 api.js 的 fetchAllRecords）
 * 输出：聚合后的结构化数据（见下方 AGGREGATED_DATA 结构注释）
 * ============================================================
 */

/**
 * 将毫秒时间戳转换为本地日期字符串（YYYY-MM-DD）
 *
 * 使用本地时区，不手动计算偏移。
 * 例如：北京时间 2026-09-02 凌晨 1 点的 UTC 时间戳，
 *   new Date(ts) 在本地时区下仍是 2026-09-02。
 *
 * @param {number} timestamp - 毫秒级 UTC 时间戳
 * @returns {string} YYYY-MM-DD 格式日期
 */
function timestampToDateStr(timestamp) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 安全获取数值字段，null/undefined 返回 0
 *
 * @param {*} value - 原始值
 * @returns {number} 安全数值
 */
function safeNum(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

/**
 * 判断记录是否为 Charged（已计费）
 *
 * 规则：cost > 0 → Charged；cost == 0 或 null → Not Charged
 *
 * @param {object} record - 原始记录
 * @returns {boolean} true = Charged, false = Not Charged
 */
function isCharged(record) {
  return safeNum(record.cost) > 0;
}

/**
 * 聚合原始记录数组
 *
 * 处理流程：
 *   1. 遍历 records，按 begin_at 转换为本地日期
 *   2. 同一天 + 同一 model_category + 同一计费状态的记录合并
 *   3. 累加 credits, cost, original_cost
 *   4. 计算折扣因子（加权平均或取第一条）
 *   5. 按日期降序排列（最新优先）
 *   6. 计算汇总数据
 *
 * @param {Array} records - 原始记录数组
 * @returns {object} 聚合后的结构化数据
 *
 * 返回结构：
 * {
 *   summary: {
 *     totalCredits,        // 总积分
 *     totalCost,           // 总花费（美元）
 *     dailyAvgCredits,     // 日均积分
 *     dailyAvgCost,        // 日均花费
 *     chargedCredits,      // Charged 积分
 *     chargedCost,         // Charged 花费
 *     notChargedCredits,   // Not Charged 积分
 *     notChargedCost,      // Not Charged 花费
 *     dayCount,            // 天数
 *   },
 *   days: [
 *     {
 *       date,              // 'YYYY-MM-DD'
 *       totalCredits,      // 当天总积分
 *       totalCost,         // 当天总花费
 *       categories: [
 *         {
 *           modelCategory,    // 模型类别
 *           credits,          // 积分
 *           cost,             // 花费
 *           originalCost,     // 原始花费
 *           discountFactor,   // 折扣因子
 *           isCharged,        // 是否计费
 *           recordCount,      // 原始记录条数
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
function aggregate(records) {
  // 空数据返回空结构
  if (!records || records.length === 0) {
    return {
      summary: {
        totalCredits: 0,
        totalCost: 0,
        totalCalls: 0,
        dailyAvgCredits: 0,
        dailyAvgCost: 0,
        dailyAvgCalls: 0,
        chargedCredits: 0,
        chargedCost: 0,
        notChargedCredits: 0,
        notChargedCost: 0,
        dayCount: 0
      },
      days: []
    };
  }

  // 第一层：按日期分组
  // 使用 Map 保持插入顺序，后续再排序
  const dayMap = new Map();

  for (const record of records) {
    // 获取日期字符串（本地时区）
    const dateStr = timestampToDateStr(safeNum(record.begin_at) || safeNum(record.time));

    // 初始化日期分组
    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, {
        date: dateStr,
        totalCredits: 0,
        totalCost: 0,
        // 第二层：按 model_category + isCharged 分组
        // key = `${modelCategory}||${isCharged}`
        categoryMap: new Map()
      });
    }

    const dayData = dayMap.get(dateStr);

    // 获取模型类别，空字符串归入 "Unknown"
    const modelCategory = (record.model_category && record.model_category.trim()) || 'Unknown';
    const charged = isCharged(record);
    const catKey = `${modelCategory}||${charged}`;

    // 初始化类别分组
    if (!dayData.categoryMap.has(catKey)) {
      dayData.categoryMap.set(catKey, {
        modelCategory: modelCategory,
        credits: 0,
        cost: 0,
        originalCost: 0,
        discountFactor: 1, // 默认无折扣
        discountVisible: false,
        isCharged: charged,
        recordCount: 0
      });
    }

    const catData = dayData.categoryMap.get(catKey);

    // 累加数值
    const credits = safeNum(record.credits);
    const cost = safeNum(record.cost);
    const originalCost = safeNum(record.original_cost);
    const originalCredits = safeNum(record.original_credits);

    catData.credits += credits;
    catData.cost += cost;
    catData.originalCost += originalCost;
    catData.recordCount++;

    // 折扣因子：取第一条记录的值（同一类别同一计费状态下折扣通常一致）
    // 如果有差异，取加权平均（按 credits 加权）
    if (catData.recordCount === 1) {
      catData.discountFactor = safeNum(record.discount_factor) || 1;
      catData.discountVisible = !!record.discount_visible;
    } else {
      // 加权平均折扣因子
      const prevWeight = catData.credits - credits; // 之前累计的 credits
      const prevFactor = catData.discountFactor;
      const currFactor = safeNum(record.discount_factor) || 1;
      const totalWeight = prevWeight + credits;
      if (totalWeight > 0) {
        catData.discountFactor = (prevFactor * prevWeight + currFactor * credits) / totalWeight;
      }
      // 折扣可见性：任一记录可见则可见
      if (record.discount_visible) {
        catData.discountVisible = true;
      }
    }

    // 累加当天总计
    dayData.totalCredits += credits;
    dayData.totalCost += cost;
  }

  // 将 Map 转为数组并排序
  const days = Array.from(dayMap.values()).map(dayData => {
    // 类别数组：Charged 在前，Not Charged 在后；同组内按 credits 降序
    const categories = Array.from(dayData.categoryMap.values()).sort((a, b) => {
      // 先按 isCharged 排序（true 在前）
      if (a.isCharged !== b.isCharged) {
        return a.isCharged ? -1 : 1;
      }
      // 同组内按 credits 降序
      return b.credits - a.credits;
    });

    return {
      date: dayData.date,
      totalCredits: dayData.totalCredits,
      totalCost: dayData.totalCost,
      categories
    };
  });

  // 按日期降序排列（最新优先）
  days.sort((a, b) => b.date.localeCompare(a.date));

  // 计算汇总数据
  const dayCount = days.length;
  let totalCredits = 0;
  let totalCost = 0;
  let totalCalls = 0;
  let chargedCredits = 0;
  let chargedCost = 0;
  let notChargedCredits = 0;
  let notChargedCost = 0;

  for (const day of days) {
    totalCredits += day.totalCredits;
    totalCost += day.totalCost;

    for (const cat of day.categories) {
      totalCalls += cat.recordCount;
      if (cat.isCharged) {
        chargedCredits += cat.credits;
        chargedCost += cat.cost;
      } else {
        notChargedCredits += cat.credits;
        notChargedCost += cat.cost;
      }
    }
  }

  return {
    summary: {
      totalCredits,
      totalCost,
      totalCalls,
      dailyAvgCredits: dayCount > 0 ? Math.round(totalCredits / dayCount) : 0,
      dailyAvgCost: dayCount > 0 ? Math.round(totalCost / dayCount * 100) / 100 : 0,
      dailyAvgCalls: dayCount > 0 ? Math.round(totalCalls / dayCount) : 0,
      chargedCredits,
      chargedCost,
      notChargedCredits,
      notChargedCost,
      dayCount
    },
    days
  };
}

// 暴露到全局
window.QoderAggregator = {
  aggregate,
  timestampToDateStr,
  safeNum,
  isCharged
};
