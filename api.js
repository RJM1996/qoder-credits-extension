/**
 * ============================================================
 * api.js — API 请求与分页模块
 * ============================================================
 *
 * 职责：
 *   1. 根据时间范围计算 start_time / end_time（毫秒级 UTC 时间戳）
 *   2. 发起 fetch 请求，携带 cookie（credentials: 'include'）
 *   3. 处理分页：检查 page_result.next_token，非空则继续请求
 *   4. 合并所有分页的 data 数组，返回完整 records
 *
 * 关键约束：
 *   - 15s 超时（AbortController）
 *   - 最大 50 页限制（防止无限分页）
 *   - 用户快速切换时间范围时取消上一个请求（AbortController）
 *   - credentials: 'include' 确保 cookie 自动携带
 * ============================================================
 */

/** API 基础路径 */
const API_BASE = 'https://qoder.com/api/v1/me/usages/big_model_credits/histories';

/** 每页条数 */
const PAGE_SIZE = 100;

/** 最大分页数限制 */
const MAX_PAGES = 50;

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * 根据预设时间范围计算 start_time / end_time
 *
 * @param {'today'|'7days'|'30days'} preset - 预设范围
 * @returns {{startTime: number, endTime: number}} 毫秒级 UTC 时间戳
 */
function getTimeRange(preset) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (preset) {
    case 'today':
      // start 已是今天 00:00:00
      break;
    case '7days':
      start.setDate(start.getDate() - 6); // 含今天共7天
      break;
    case '30days':
      start.setDate(start.getDate() - 29); // 含今天共30天
      break;
    default:
      break;
  }

  return {
    startTime: start.getTime(),
    endTime: end.getTime()
  };
}

/**
 * 构造单页请求 URL
 *
 * @param {number} page - 页码
 * @param {number} startTime - 开始时间戳
 * @param {number} endTime - 结束时间戳
 * @param {string|null} nextToken - 分页 token（首页不传）
 * @returns {string} 完整请求 URL
 */
function buildRequestUrl(page, startTime, endTime, nextToken) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    start_time: String(startTime),
    end_time: String(endTime),
    order_by: 'begin_at',
    order: '-1'
  });

  if (nextToken) {
    params.set('next_token', nextToken);
  }

  return `${API_BASE}?${params.toString()}`;
}

/**
 * 发起单页请求
 *
 * @param {number} page - 页码
 * @param {number} startTime - 开始时间戳
 * @param {number} endTime - 结束时间戳
 * @param {string|null} nextToken - 分页 token
 * @param {AbortSignal} signal - AbortController 信号（用于取消请求）
 * @returns {Promise<object>} API 响应 JSON
 * @throws {Error} 请求失败时抛出带友好消息的错误
 */
async function fetchPage(page, startTime, endTime, nextToken, signal) {
  const url = buildRequestUrl(page, startTime, endTime, nextToken);

  // 设置超时定时器
  const timeoutId = setTimeout(() => {
    // 超时后通过 AbortController 取消请求
    // 注意：signal 由外部传入，这里只负责超时触发
    // 实际取消逻辑在 fetchAllRecords 中统一管理
  }, REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include', // 携带 cookie
      headers: {
        'Accept': 'application/json'
      },
      signal: signal // 绑定 AbortSignal
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      // 根据 HTTP 状态码返回友好错误消息
      throw new Error(mapHttpError(resp.status));
    }

    const json = await resp.json();

    // 校验响应结构
    if (!json || !Array.isArray(json.data)) {
      throw new Error('响应数据格式异常');
    }

    return json;
  } catch (err) {
    clearTimeout(timeoutId);

    // AbortError（用户主动取消或超时）
    if (err.name === 'AbortError') {
      throw new Error('请求超时或已取消，请重试');
    }

    // TypeError（网络断开 / DNS 解析失败等）
    if (err instanceof TypeError) {
      throw new Error('网络连接失败，请检查网络后重试');
    }

    // 已经是友好错误消息的直接抛出
    throw err;
  }
}

/**
 * 将 HTTP 状态码映射为用户友好的错误消息
 *
 * @param {number} status - HTTP 状态码
 * @returns {string} 友好错误消息
 */
function mapHttpError(status) {
  switch (status) {
    case 401:
    case 403:
      return '未登录或登录已过期，请在 qoder.com 重新登录后重试';
    case 429:
      return '请求过于频繁，请稍后重试';
    case 500:
    case 502:
    case 503:
    case 504:
      return '服务器错误，请稍后重试';
    default:
      return `API 请求失败: ${status}`;
  }
}

/**
 * 拉取指定时间范围内的全部记录（自动分页）
 *
 * 核心逻辑：
 *   1. 从第 1 页开始请求
 *   2. 检查 page_result.next_token，非空则继续请求下一页
 *   3. 合并所有页的 data 数组
 *   4. 最大 50 页限制，超出时停止并标记不完整
 *
 * @param {number} startTime - 开始时间戳（毫秒级 UTC）
 * @param {number} endTime - 结束时间戳（毫秒级 UTC）
 * @param {function} [onProgress] - 进度回调 (loadedCount, page) => void
 * @param {AbortSignal} [externalSignal] - 外部 AbortSignal（用于用户切换时间范围时取消）
 * @returns {Promise<{records: Array, isComplete: boolean}>} 全部记录 + 是否完整
 * @throws {Error} 请求失败时抛出
 */
async function fetchAllRecords(startTime, endTime, onProgress, externalSignal) {
  // 创建内部 AbortController，同时监听外部 signal
  const internalController = new AbortController();
  let timeoutHandle = null;

  // 如果有外部 signal，转发 abort 事件
  if (externalSignal) {
    if (externalSignal.aborted) {
      internalController.abort();
    } else {
      externalSignal.addEventListener('abort', () => {
        internalController.abort();
      }, { once: true });
    }
  }

  const allRecords = [];
  let nextToken = null;
  let page = 1;
  let isComplete = true;

  try {
    do {
      // 每页请求前设置超时
      timeoutHandle = setTimeout(() => {
        internalController.abort();
      }, REQUEST_TIMEOUT_MS);

      const json = await fetchPage(
        page,
        startTime,
        endTime,
        nextToken,
        internalController.signal
      );

      clearTimeout(timeoutHandle);
      timeoutHandle = null;

      // 合并本页数据
      const pageData = json.data || [];
      allRecords.push(...pageData);

      // 进度回调
      if (typeof onProgress === 'function') {
        onProgress(allRecords.length, page);
      }

      // 检查分页 token
      nextToken = (json.page_result && json.page_result.next_token) || null;

      // 如果有 next_token，准备下一页
      if (nextToken) {
        page++;
        // 检查是否超过最大页数限制
        if (page > MAX_PAGES) {
          isComplete = false;
          break;
        }
      }
    } while (nextToken);

    return { records: allRecords, isComplete };
  } finally {
    // 确保清理超时定时器
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    // 中止 controller（如果尚未中止）
    if (!internalController.signal.aborted) {
      internalController.abort();
    }
  }
}

// 暴露到全局（popup 环境下非 ES module）
window.QoderAPI = {
  getTimeRange,
  fetchAllRecords,
  MAX_PAGES,
  REQUEST_TIMEOUT_MS
};
