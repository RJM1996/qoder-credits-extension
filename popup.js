/**
 * ============================================================
 * popup.js — 入口控制器
 * ============================================================
 *
 * 职责：
 *   1. DOMContentLoaded 时默认选中"今天"并触发数据加载
 *   2. 监听时间范围按钮点击，切换 active 状态并重新加载数据
 *   3. 加载中显示 loading 状态，加载完成隐藏
 *   4. 加载失败显示错误信息和重试按钮
 *   5. 调用 api.js 获取数据 → 调用 aggregator.js 聚合 → 调用 renderer.js 渲染
 *   6. 加载配额卡片：拉取配额 API + 近 30 天日均 → quota.js 规划 → 渲染
 *   7. 登录过期（401/403）时显示"去登录"按钮，点击打开 qoder.com
 *
 * 关键约束：
 *   - 用户快速切换时间范围时取消上一个请求（AbortController）
 *   - "今天"面板每次都重新请求，其他面板数据缓存一天
 *   - 配额数据不缓存，每次打开 popup 都重新请求
 * ============================================================
 */

/** 当前选中的时间范围 */
let currentRange = 'today';

/** 当前请求的 AbortController（用于取消上一个请求） */
let currentAbortController = null;

/** DOM 元素引用 */
let rangeButtons = [];

/**
 * 缓存管理
 *
 * 缓存策略：
 *   - "今天"不缓存，每次都重新请求
 *   - 其他面板（昨天/近7天/近30天）缓存到 chrome.storage.local
 *   - 缓存 key 格式：cache_<range>_<YYYY-MM-DD>
 *   - 缓存含 records + isComplete + 聚合结果，当天有效
 */

/**
 * 获取今天的日期字符串（YYYY-MM-DD，本地时区）
 *
 * @returns {string}
 */
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 生成缓存 key
 *
 * @param {string} range - 时间范围
 * @returns {string}
 */
function getCacheKey(range) {
  return `cache_${range}_${getTodayStr()}`;
}

/**
 * 从缓存读取数据
 *
 * @param {string} range - 时间范围
 * @returns {Promise<object|null>} 缓存数据 { records, isComplete, aggregated } 或 null
 */
async function getCache(range) {
  return new Promise(resolve => {
    chrome.storage.local.get(getCacheKey(range), result => {
      resolve(result[getCacheKey(range)] || null);
    });
  });
}

/**
 * 写入缓存
 *
 * @param {string} range - 时间范围
 * @param {object} data - { records, isComplete, aggregated }
 */
async function setCache(range, data) {
  const key = getCacheKey(range);
  const obj = {};
  obj[key] = data;
  return new Promise(resolve => {
    chrome.storage.local.set(obj, resolve);
  });
}

/**
 * 设置时间范围按钮的 active 状态
 *
 * @param {string} range - 'yesterday' | 'today' | '7days' | '30days'
 */
function setActiveButton(range) {
  rangeButtons.forEach(btn => {
    if (btn.dataset.range === range) {
      btn.classList.add('range-btn--active');
    } else {
      btn.classList.remove('range-btn--active');
    }
  });
}

/**
 * 设置时间范围按钮的禁用状态
 *
 * @param {boolean} disabled - 是否禁用
 */
function setButtonsDisabled(disabled) {
  rangeButtons.forEach(btn => {
    btn.disabled = disabled;
  });
}

/**
 * 判断错误是否为登录过期（401/403）
 *
 * @param {Error} err - 错误对象（api.js 会挂 status 属性）
 * @returns {boolean}
 */
function isAuthError(err) {
  return !!(err && (err.status === 401 || err.status === 403));
}

/**
 * 获取近 30 天日均积分（用于配额规划）
 *
 * 优先复用 30days 面板缓存；未命中时单独拉取近 30 天数据计算。
 * 拉取失败或无数据时返回 null（规划降级为"无法预估"）。
 *
 * @returns {Promise<number|null>} 日均积分，无数据/失败返回 null
 */
async function get30DaysDailyAvg() {
  try {
    // 先查 30days 面板缓存（当天有效）
    const cached = await getCache('30days');
    if (cached && cached.aggregated && cached.aggregated.summary) {
      const avg = cached.aggregated.summary.dailyAvgCredits;
      if (cached.aggregated.summary.dayCount > 0) {
        return avg;
      }
      return null; // 缓存存在但无记录
    }

    // 缓存未命中，单独拉取近 30 天数据
    const { startTime, endTime } = window.QoderAPI.getTimeRange('30days');
    const { records } = await window.QoderAPI.fetchAllRecords(startTime, endTime);
    const aggregated = window.QoderAggregator.aggregate(records);

    // 回写缓存，供 30days 面板复用
    await setCache('30days', { records, isComplete: true, aggregated });

    if (aggregated.summary.dayCount > 0) {
      return aggregated.summary.dailyAvgCredits;
    }
    return null;
  } catch (err) {
    // 日均获取失败不阻塞配额卡片，规划降级
    return null;
  }
}

/**
 * 加载配额卡片（每次打开 popup 都重新请求，不缓存）
 *
 * 流程：
 *   1. 并行拉取配额 API 与近 30 天日均
 *   2. quota.js buildPlan 计算每日可用规划
 *   3. renderer.js renderQuotaCard 渲染
 *   4. 登录过期（401/403）时显示"去登录"按钮
 */
async function loadQuota() {
  try {
    // 并行拉取：配额 + 近 30 天日均（日均失败不阻塞）
    const quotaPromise = window.QoderAPI.fetchQuota();
    const avgPromise = get30DaysDailyAvg();

    const quotaSummary = await quotaPromise;
    const dailyAvg = await avgPromise;

    // 计算规划并渲染
    const plan = window.QoderQuota.buildPlan(quotaSummary, dailyAvg);
    window.QoderRenderer.renderQuotaCard(quotaSummary, plan);
  } catch (err) {
    // 登录过期：显示提示 + "去登录"按钮
    if (isAuthError(err)) {
      window.QoderRenderer.showError('登录已过期', true);
      return;
    }
    // 其他错误：配额卡片保持隐藏，不打断主表格流程
    if (dom_quotaCardSafe()) {
      // 静默失败即可，主流程错误由 loadData 处理
    }
  }
}

/** 配额卡片元素安全访问（卡片可能不存在于旧 DOM） */
function dom_quotaCardSafe() {
  const card = document.getElementById('quotaCard');
  return card ? true : false;
}

/**
 * 打开 qoder.com 登录/用量页面
 * popup 中使用 chrome.tabs.create，打开后 popup 自动关闭属正常行为。
 */
function openLoginPage() {
  const url = 'https://qoder.com/account/usage';
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url, active: true });
  } else {
    window.open(url, '_blank');
  }
}

/**
 * 加载数据主流程
 *
 * 流程：
 *   1. 取消上一个正在进行的请求（如果有）
 *   2. 创建新的 AbortController
 *   3. 显示 loading 状态
 *   4. "今天"每次都请求；其他面板先查缓存，命中则直接渲染
 *   5. 缓存未命中时调用 api.js 获取数据
 *   6. 调用 aggregator.js 聚合
 *   7. 调用 renderer.js 渲染
 *   8. 异常时显示错误状态
 *
 * @param {string} range - 时间范围预设
 */
async function loadData(range) {
  // 取消上一个请求
  if (currentAbortController) {
    currentAbortController.abort();
  }

  // 创建新的 AbortController
  currentAbortController = new AbortController();

  // 更新当前选中
  currentRange = range;
  setActiveButton(range);

  // 显示 loading
  window.QoderRenderer.showLoading('加载中…');
  setButtonsDisabled(true);

  try {
    // "今天"不缓存，其他面板先查缓存
    if (range !== 'today') {
      const cached = await getCache(range);
      if (cached && cached.aggregated) {
        // 缓存命中，直接渲染
        window.QoderRenderer.renderTable(cached.aggregated, cached.isComplete);
        return;
      }
    }

    // 计算时间范围
    const { startTime, endTime } = window.QoderAPI.getTimeRange(range);

    // 拉取数据（带进度回调）
    const { records, isComplete } = await window.QoderAPI.fetchAllRecords(
      startTime,
      endTime,
      (loadedCount, page) => {
        // 更新 loading 文字，显示进度
        window.QoderRenderer.showLoading('加载中…', loadedCount);
      },
      currentAbortController.signal
    );

    // 如果请求已被取消（用户切换了时间范围），不渲染
    if (currentAbortController.signal.aborted) {
      return;
    }

    // 聚合数据
    const aggregated = window.QoderAggregator.aggregate(records);

    // 渲染表格
    window.QoderRenderer.renderTable(aggregated, isComplete);

    // 写入缓存（"今天"不缓存）
    if (range !== 'today') {
      await setCache(range, { records, isComplete, aggregated });
    }

  } catch (err) {
    // 如果是 AbortError（用户主动取消），不显示错误
    if (err.message && (err.message.includes('取消') || err.name === 'AbortError')) {
      return;
    }

    // 显示错误（登录过期时附带"去登录"按钮）
    window.QoderRenderer.showError(err.message || '未知错误', isAuthError(err));
  } finally {
    setButtonsDisabled(false);
  }
}

/**
 * 初始化 popup
 *
 * 在 DOMContentLoaded 时调用：
 *   1. 初始化 renderer 的 DOM 引用
 *   2. 获取所有时间范围按钮
 *   3. 为每个按钮绑定点击事件
 *   4. 绑定重试按钮点击事件
 *   5. 绑定"去登录"按钮点击事件
 *   6. 默认选中"今天"并触发数据加载
 *   7. 并行加载配额卡片（不缓存，每次刷新）
 */
function initPopup() {
  // 初始化 renderer
  window.QoderRenderer.initRenderer();

  // 获取所有时间范围按钮
  rangeButtons = Array.from(document.querySelectorAll('.range-btn'));

  // 绑定时间范围按钮点击事件
  rangeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      if (range === currentRange) return; // 已选中，不重复加载
      loadData(range);
    });
  });

  // 绑定重试按钮
  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      loadData(currentRange);
    });
  }

  // 绑定"去登录"按钮（登录过期时显示）
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', openLoginPage);
  }

  // 默认加载"今天"数据
  loadData('today');

  // 并行加载配额卡片（不阻塞主表格）
  loadQuota();
}

// DOMContentLoaded → 初始化
document.addEventListener('DOMContentLoaded', initPopup);
