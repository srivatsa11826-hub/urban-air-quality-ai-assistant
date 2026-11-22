/**
 * @fileoverview Resilient HTTP Client for Python FastAPI Microservice
 * Provides zero-downtime, fault-tolerant RPCs with strict 1500ms timeouts.
 * Gracefully returns null if the Python microservice is offline or unreachable.
 */

const fetch = require('node-fetch');
const { PYTHON_SERVICE_URL, PYTHON_SERVICE_TIMEOUT_MS } = require('../config/constants');

/**
 * Dispatch an asynchronous HTTP POST to the Python FastAPI microservice.
 * Automatically catches network errors, timeouts, or connection failures.
 *
 * @param {string} endpoint - API path (e.g. '/analyze', '/forecast', '/advisory-context')
 * @param {object} body - Request payload dictionary
 * @param {number} timeoutMs - Max wait time in ms before aborting (default 1500ms)
 * @returns {Promise<object|null>} JSON response object or null on failure
 */
async function callPythonService(endpoint, body = {}, timeoutMs = PYTHON_SERVICE_TIMEOUT_MS) {
  try {
    const url = `${PYTHON_SERVICE_URL.replace(/\/+$/, '')}${endpoint}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: timeoutMs,
    });

    if (!resp.ok) {
      return null;
    }

    return await resp.json();
  } catch (err) {
    // Graceful offline fallback: log debug trace only, do not interrupt execution
    return null;
  }
}

/**
 * Check if the Python FastAPI microservice is online and responsive.
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} True if online, false otherwise
 */
async function isPythonServiceHealthy(timeoutMs = 1000) {
  try {
    const url = `${PYTHON_SERVICE_URL.replace(/\/+$/, '')}/health`;
    const resp = await fetch(url, { method: 'GET', timeout: timeoutMs });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

module.exports = {
  callPythonService,
  isPythonServiceHealthy,
};
