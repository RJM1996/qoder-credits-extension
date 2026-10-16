/**
 * ============================================================
 * quota.js — 积分配额与每日可用量计算模块
 * ============================================================
 *
 * 职责：
 *   1. 计算下一个重置时刻（每月 23 号 0 点，处理跨月/跨年）
 *   2. 计算剩余天数 daysLeft（从现在到重置时刻向上取整，至少 1 天）
 *   3. 结合近 30 天日均用量，预估积分是否够用到重置日
 *   4. 计算接下来每天平均可用积分（remaining / daysLeft）
 *   5. 生成结论与建议文案（富余 → 可多用高倍率模型；紧张 → 建议低倍率）
 *
 * 输入：
 *   - quotaSummary：来自 api.js fetchQuota 的 shared_quota.quota_summary
 *     （remaining_value / used_value / limit_value / usage_percentage / unit）
 *   - dailyAvgCredits：近 30 天日均积分（null 表示无数据）
 *
 * 输出：buildPlan 返回的规划对象（见下方 JSDoc）
 * ============================================================
 */

/** 每月重置日（几号） */
const QUOTA_RESET_DAY = 23;

/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 计算下一个重置时刻
 *
 * 规则：每月 23 号 0 点重置
 *   - 今天日期 < 23 号 → 本月 23 号 0 点
 *   - 今天日期 >= 23 号（23 号当天 0 点已过）→ 下月 23 号 0 点
 *   - 12 月跨年 → 次年 1 月 23 号
 *
 * @param {Date} [now=new Date()] - 当前时间
 * @returns {Date} 下一个重置时刻（本地时区 0 点）
 */
function getNextResetTime(now) {
  const current = now instanceof Date ? now : new Date();
  let year = current.getFullYear();
  let month = current.getMonth(); // 0-based

  if (current.getDate() >= QUOTA_RESET_DAY) {
    // 已到/过 23 号，指向下月 23 号
    month += 1;
    if (month > 11) {
      month = 0;   // 跨年：12 月 → 次年 1 月
      year += 1;
    }
  }

  return new Date(year, month, QUOTA_RESET_DAY, 0, 0, 0, 0);
}

/**
 * 计算剩余天数（从现在到重置时刻）
 *
 * 规则：向上取整，至少 1 天。
 *   - 例：现在 10-16 20:00，重置 10-23 00:00 → 差 6.17 天 → 7 天
 *   - 例：恰好等于重置时刻 → 0 天 → 兜底为 1 天
 *
 * @param {Date} [now=new Date()] - 当前时间
 * @returns {number} 剩余天数（>= 1）
 */
function getDaysLeft(now) {
  const current = now instanceof Date ? now : new Date();
  const reset = getNextResetTime(current);
  const diff = reset.getTime() - current.getTime();
  return Math.max(1, Math.ceil(diff / DAY_MS));
}

/**
 * 构建每日可用量规划
 *
 * @param {object} quotaSummary - 配额摘要（remaining_value / limit_value / unit 等）
 * @param {number|null} dailyAvgCredits - 近 30 天日均积分（null = 无数据）
 * @returns {object} 规划结果：
 * {
 *   resetDate,        // 'YYYY-MM-DD' 下一个重置日
 *   daysLeft,         // 剩余天数（>= 1）
 *   dailyAvgCredits,  // 透传日均用量（null = 无数据）
 *   projectedUsage,   // 预计到重置日的总用量（日均 × daysLeft，无数据为 null）
 *   isSufficient,     // 积分是否够用（null = 无法判断）
 *   dailyAvailable,   // 每天平均可用积分（remaining / daysLeft，保留 1 位小数）
 *   message           // 结论与建议文案
 * }
 */
function buildPlan(quotaSummary, dailyAvgCredits) {
  const remaining = Number(quotaSummary && quotaSummary.remaining_value) || 0;
  const daysLeft = getDaysLeft();
  const reset = getNextResetTime();

  const resetDate = `${reset.getFullYear()}-${String(reset.getMonth() + 1).padStart(2, '0')}-${String(reset.getDate()).padStart(2, '0')}`;

  // 每天平均可用积分（保留 1 位小数）
  const dailyAvailable = Math.round((remaining / daysLeft) * 10) / 10;

  let projectedUsage = null;
  let isSufficient = null;
  let message = '';

  if (dailyAvgCredits === null || dailyAvgCredits === undefined) {
    // 无近 30 天数据，无法预估
    message = `暂无近 30 天用量数据，无法预估是否够用；按剩余 ${daysLeft} 天计，每天平均可用 ${dailyAvailable} 积分`;
  } else if (dailyAvgCredits <= 0) {
    // 近 30 天无消耗
    isSufficient = true;
    projectedUsage = 0;
    message = `近 30 天无积分消耗，剩余积分足够用到重置日（${resetDate}）`;
  } else {
    projectedUsage = dailyAvgCredits * daysLeft;
    isSufficient = remaining >= projectedUsage;

    if (isSufficient) {
      message = `按当前用量（日均 ${dailyAvgCredits}），积分足够用到重置日（${resetDate}），剩余日均可用 ${dailyAvailable} 积分，可适当多用高倍率模型`;
    } else {
      const shortfall = Math.ceil(projectedUsage - remaining);
      message = `按当前用量（日均 ${dailyAvgCredits}），积分预计撑不到重置日（${resetDate}，缺口约 ${shortfall}），建议控制用量、优先使用低倍率模型`;
    }
  }

  return {
    resetDate,
    daysLeft,
    dailyAvgCredits: dailyAvgCredits === null ? null : dailyAvgCredits,
    projectedUsage,
    isSufficient,
    dailyAvailable,
    message
  };
}

// 暴露到全局（popup 环境下非 ES module）
window.QoderQuota = {
  QUOTA_RESET_DAY,
  getNextResetTime,
  getDaysLeft,
  buildPlan
};
