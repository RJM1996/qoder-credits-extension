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
 *
 * 关键约束：
 *   - 用户快速切换时间范围时取消上一个请求（AbortController）
 *   - popup 关闭后状态不保留，每次打开重新请求
 * ============================================================
 */

/** 当前选中的时间范围 */
let currentRange = 'today';

/** 当前请求的 AbortController（用于取消上一个请求） */
let currentAbortController = null;

/** DOM 元素引用 */
let rangeButtons = [];

/**
 * 设置时间范围按钮的 active 状态
 *
 * @param {string} range - 'today' | '7days' | '30days'
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
 * 加载数据主流程
 *
 * 流程：
 *   1. 取消上一个正在进行的请求（如果有）
 *   2. 创建新的 AbortController
 *   3. 显示 loading 状态
 *   4. 调用 api.js 获取数据
 *   5. 调用 aggregator.js 聚合
 *   6. 调用 renderer.js 渲染
 *   7. 异常时显示错误状态
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

  } catch (err) {
    // 如果是 AbortError（用户主动取消），不显示错误
    if (err.message && (err.message.includes('取消') || err.name === 'AbortError')) {
      return;
    }

    // 显示错误
    window.QoderRenderer.showError(err.message || '未知错误');
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
 *   5. 默认选中"今天"并触发数据加载
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

  // 默认加载"今天"数据
  loadData('today');
}

// DOMContentLoaded → 初始化
document.addEventListener('DOMContentLoaded', initPopup);
