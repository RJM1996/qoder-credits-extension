/**
 * ============================================================
 * renderer.js — 表格渲染模块
 * ============================================================
 *
 * 职责：
 *   1. 渲染汇总行（总积分、总花费）
 *   2. 渲染日均统计行
 *   3. 按天渲染表格行，每天内按 model_category 分组
 *   4. 用分区标题区分 Charged / Not Charged
 *   5. 渲染 loading 状态和错误状态
 *
 * 渲染规则：
 *   - 表格列：日期 | 模型类别 | 积分 | 花费 | 原始花费 | 折扣因子
 *   - Charged 和 Not Charged 分两个区域展示，各有小标题
 *   - 每天末尾显示该天小计行
 *   - 金额保留两位小数，积分取整
 * ============================================================
 */

/** DOM 元素引用（在 init 时获取） */
let dom = null;

/**
 * 初始化 DOM 引用
 * 在 popup.js DOMContentLoaded 后调用
 */
function initRenderer() {
  dom = {
    summaryBar: document.getElementById('summaryBar'),
    totalCredits: document.getElementById('totalCredits'),
    totalCost: document.getElementById('totalCost'),
    content: document.getElementById('content'),
    loadingState: document.getElementById('loadingState'),
    loadingText: document.getElementById('loadingText'),
    errorState: document.getElementById('errorState'),
    errorText: document.getElementById('errorText'),
    emptyState: document.getElementById('emptyState'),
    tableWrap: document.getElementById('tableWrap'),
    tableBody: document.getElementById('tableBody'),
    tableFoot: document.getElementById('tableFoot')
  };
}

/**
 * 隐藏所有状态视图
 */
function hideAllStates() {
  if (!dom) return;
  dom.loadingState.style.display = 'none';
  dom.errorState.style.display = 'none';
  dom.emptyState.style.display = 'none';
  dom.tableWrap.style.display = 'none';
}

/**
 * 显示 loading 状态
 *
 * @param {string} [text='加载中…'] - loading 提示文字
 * @param {number} [loadedCount] - 已加载条数（可选，用于进度提示）
 */
function showLoading(text, loadedCount) {
  if (!dom) return;
  hideAllStates();
  dom.loadingState.style.display = 'flex';
  if (text) {
    dom.loadingText.textContent = loadedCount ? `${text}（已加载 ${loadedCount} 条）` : text;
  } else {
    dom.loadingText.textContent = loadedCount ? `加载中…（已加载 ${loadedCount} 条）` : '加载中…';
  }
}

/**
 * 显示错误状态
 *
 * @param {string} message - 错误消息
 */
function showError(message) {
  if (!dom) return;
  hideAllStates();
  dom.errorState.style.display = 'flex';
  dom.errorText.textContent = message || '未知错误';
}

/**
 * 显示空数据状态
 */
function showEmpty() {
  if (!dom) return;
  hideAllStates();
  dom.emptyState.style.display = 'flex';
}

/**
 * 格式化金额（保留两位小数，带 $ 前缀）
 *
 * @param {number} value - 金额
 * @returns {string} 格式化后的金额字符串
 */
function formatCost(value) {
  return '$' + (Number(value) || 0).toFixed(2);
}

/**
 * 格式化积分（取整，千分位）
 *
 * @param {number} value - 积分
 * @returns {string} 格式化后的积分字符串
 */
function formatCredits(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

/**
 * 格式化折扣因子（保留4位小数）
 *
 * @param {number} value - 折扣因子
 * @returns {string} 格式化后的折扣因子字符串
 */
function formatDiscount(value) {
  const v = Number(value) || 1;
  // 如果是整数 1，显示 "1.0"
  if (v === 1) return '1.0';
  return v.toFixed(4);
}

/**
 * 创建一个表格行 <tr>
 *
 * @param {string} date - 日期
 * @param {string} modelCategory - 模型类别
 * @param {number} credits - 积分
 * @param {number} cost - 花费
 * @param {number} originalCost - 原始花费
 * @param {number} discountFactor - 折扣因子
 * @param {string} [rowClass] - 额外的行 class
 * @returns {HTMLTableRowElement} 表格行元素
 */
function createRow(date, modelCategory, credits, cost, originalCost, discountFactor, rowClass) {
  const tr = document.createElement('tr');
  if (rowClass) {
    tr.className = rowClass;
  }

  tr.innerHTML = `
    <td class="col-date">${date}</td>
    <td class="col-model">${modelCategory}</td>
    <td class="col-credits">${formatCredits(credits)}</td>
    <td class="col-cost">${formatCost(cost)}</td>
    <td class="col-orig-cost">${formatCost(originalCost)}</td>
    <td class="col-discount">${formatDiscount(discountFactor)}</td>
  `;

  return tr;
}

/**
 * 创建分区标题行（Charged / Not Charged）
 *
 * @param {string} title - 分区标题
 * @param {boolean} isCharged - 是否为 Charged 分区
 * @returns {HTMLTableRowElement} 分区标题行
 */
function createSectionRow(title, isCharged) {
  const tr = document.createElement('tr');
  tr.className = isCharged ? 'row-section row-section--charged' : 'row-section row-section--not-charged';
  tr.innerHTML = `<td colspan="6">${title}</td>`;
  return tr;
}

/**
 * 创建小计行
 *
 * @param {string} date - 日期
 * @param {number} credits - 当天总积分
 * @param {number} cost - 当天总花费
 * @returns {HTMLTableRowElement} 小计行
 */
function createSubtotalRow(date, credits, cost) {
  const tr = document.createElement('tr');
  tr.className = 'row-subtotal';
  tr.innerHTML = `
    <td class="col-date">${date}</td>
    <td class="col-model" style="font-style:italic;">小计</td>
    <td class="col-credits">${formatCredits(credits)}</td>
    <td class="col-cost">${formatCost(cost)}</td>
    <td class="col-orig-cost">—</td>
    <td class="col-discount">—</td>
  `;
  return tr;
}

/**
 * 渲染完整表格
 *
 * 渲染流程：
 *   1. 清空表格 body 和 foot
 *   2. 更新汇总行
 *   3. 遍历 days，每天内先渲染 Charged 分区，再渲染 Not Charged 分区
 *   4. 每天末尾添加小计行
 *   5. 表尾添加日均统计行
 *
 * @param {object} aggregatedData - 聚合后的数据（来自 aggregator.js）
 * @param {boolean} isComplete - 数据是否完整（false = 分页被截断）
 */
function renderTable(aggregatedData, isComplete) {
  if (!dom) return;

  const { summary, days } = aggregatedData;

  // 空数据
  if (!days || days.length === 0) {
    showEmpty();
    return;
  }

  // 清空表格
  dom.tableBody.innerHTML = '';
  dom.tableFoot.innerHTML = '';

  // 更新汇总行
  dom.totalCredits.textContent = formatCredits(summary.totalCredits);
  dom.totalCost.textContent = formatCost(summary.totalCost);

  // 遍历每天数据
  for (const day of days) {
    // 分离 Charged 和 Not Charged 类别
    const chargedCats = day.categories.filter(c => c.isCharged);
    const notChargedCats = day.categories.filter(c => !c.isCharged);

    // 渲染 Charged 分区
    if (chargedCats.length > 0) {
      dom.tableBody.appendChild(createSectionRow('Charged', true));
      for (const cat of chargedCats) {
        dom.tableBody.appendChild(createRow(
          day.date,
          cat.modelCategory,
          cat.credits,
          cat.cost,
          cat.originalCost,
          cat.discountFactor
        ));
      }
    }

    // 渲染 Not Charged 分区
    if (notChargedCats.length > 0) {
      dom.tableBody.appendChild(createSectionRow('Not Charged', false));
      for (const cat of notChargedCats) {
        dom.tableBody.appendChild(createRow(
          day.date,
          cat.modelCategory,
          cat.credits,
          cat.cost,
          cat.originalCost,
          cat.discountFactor
        ));
      }
    }

    // 每天末尾小计行
    dom.tableBody.appendChild(createSubtotalRow(day.date, day.totalCredits, day.totalCost));
  }

  // 表尾：日均统计行
  const footTr = document.createElement('tr');
  footTr.innerHTML = `
    <td class="col-date">日均</td>
    <td class="col-model" style="font-style:italic;">${summary.dayCount} 天</td>
    <td class="col-credits">${formatCredits(summary.dailyAvgCredits)}</td>
    <td class="col-cost">${formatCost(summary.dailyAvgCost)}</td>
    <td class="col-orig-cost">—</td>
    <td class="col-discount">—</td>
  `;
  dom.tableFoot.appendChild(footTr);

  // 如果数据不完整，添加提示行
  if (!isComplete) {
    const warnTr = document.createElement('tr');
    warnTr.style.cssText = 'background:#fff3cd;';
    warnTr.innerHTML = `
      <td colspan="6" style="color:#856404;font-style:italic;text-align:center;padding:6px;">
        ⚠ 数据量过大（超过 ${window.QoderAPI.MAX_PAGES} 页），仅显示部分数据，建议缩小时间范围
      </td>
    `;
    dom.tableBody.appendChild(warnTr);
  }

  // 显示表格
  hideAllStates();
  dom.tableWrap.style.display = 'block';
}

// 暴露到全局
window.QoderRenderer = {
  initRenderer,
  showLoading,
  showError,
  showEmpty,
  renderTable,
  hideAllStates
};
