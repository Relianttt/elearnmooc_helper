// ==UserScript==
// @name         网课全自动助手 (elearnmooc)
// @name:en      elearnmooc_helper
// @icon         https://www.elearnmooc.com/favicon.ico
// @namespace    https://github.com/Relianttt
// @version      1.2
// @description  elearnmooc 网课全自动助手：图形化控制面板，支持自动倍速播放、静音、自动连播下一节、智能处理结束弹窗、列表页自动检索未完成任务
// @description:en  Auto course helper for elearnmooc: GUI control panel with auto playback speed, mute, auto-next, smart popup handling, and auto-scan for incomplete tasks
// @author       reliant
// @license      MIT
// @icon         https://www.elearnmooc.com/favicon.ico
// @match        *://www.elearnmooc.com/*
// @match        *://elearnmooc.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // --- 存储封装（GM 优先，fallback localStorage）---
    function decodeStoredValue(raw, fallback) {
        if (raw === undefined) return fallback;
        // GM/localStorage 可能返回 string / number / boolean / object（历史版本可能直接存 object）
        if (typeof raw !== 'string') return raw;
        try {
            return JSON.parse(raw);
        } catch {
            // 兼容历史“非 JSON 字符串”场景
            return raw;
        }
    }

    function encodeStoredValue(value) {
        // 统一编码为 JSON 字符串，保证跨脚本管理器类型一致
        if (value === undefined) return undefined;
        try {
            return JSON.stringify(value);
        } catch {
            return undefined;
        }
    }

    function storageGet(key, fallback) {
        // 1) GM（全站统一）
        try {
            if (typeof GM_getValue === 'function') {
                const raw = GM_getValue(key);
                if (raw !== undefined) return decodeStoredValue(raw, fallback);
            }
        } catch { }

        // 2) localStorage（同域 fallback，并尝试自动迁移到 GM）
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                const decoded = decodeStoredValue(raw, fallback);
                try {
                    if (typeof GM_setValue === 'function') {
                        const enc = encodeStoredValue(decoded);
                        if (enc !== undefined) GM_setValue(key, enc);
                    }
                } catch { }
                return decoded;
            }
        } catch { }

        return fallback;
    }

    function storageSet(key, value) {
        if (value === undefined) {
            // Keep the old value rather than accidentally wiping user config due to a bug upstream.
            try { console.warn('[mooc-helper] storageSet: value is undefined; skip write for key:', key); } catch { }
            return;
        }
        const enc = encodeStoredValue(value);
        if (enc === undefined) {
            // e.g. circular structure passed in
            try { console.warn('[mooc-helper] storageSet: failed to encode value; skip write for key:', key); } catch { }
            return;
        }
        // GM + localStorage 双写：GM 负责全站统一，localStorage 负责无 GM 环境下可用
        try { if (typeof GM_setValue === 'function') GM_setValue(key, enc); } catch { }
        try { localStorage.setItem(key, enc); } catch { }
    }

    // --- 配置存储键名 ---
    const STORAGE_KEY = 'mooc_auto_helper_config';

    // --- 默认配置 ---
    const defaultConfig = {
        speed: 2.0,
        isMuted: true,
        autoNext: true,
        autoScan: true
    };

    // --- 加载/保存配置 ---
    function loadConfig() {
        const saved = storageGet(STORAGE_KEY, null);
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            return { ...defaultConfig, ...saved };
        }
        return { ...defaultConfig };
    }

    function saveConfig() {
        storageSet(STORAGE_KEY, config);
    }

    // --- 全局配置（从存储加载）---
    let config = loadConfig();

    // --- 模拟鼠标点击 ---
    function simulateClick(element) {
        // 获取元素位置用于事件坐标
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // 事件通用配置
        const eventOptions = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: 1
        };

        // 1. 先聚焦元素
        if (element.focus) element.focus();

        // 2. 派发 pointerdown 事件（现代浏览器）
        try {
            element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        } catch (e) { }

        // 3. 派发 mousedown 事件
        element.dispatchEvent(new MouseEvent('mousedown', eventOptions));

        // 4. 派发 pointerup 事件
        try {
            element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        } catch (e) { }

        // 5. 派发 mouseup 事件
        element.dispatchEvent(new MouseEvent('mouseup', eventOptions));

        // 6. 派发 click 事件
        element.dispatchEvent(new MouseEvent('click', eventOptions));

        // 7. 最后调用原生 click 方法（双重保险）
        if (element.click) element.click();
    }

    // --- UI 界面渲染 ---
    const POS_KEY = 'mooc_auto_helper_pos';
    const savedPos = (() => {
        const raw = storageGet(POS_KEY, null);
        if (raw && Number.isFinite(raw.top) && Number.isFinite(raw.left)) return raw;
        return null;
    })();

    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'fixed',
        top: savedPos ? savedPos.top + 'px' : '120px',
        left: savedPos ? savedPos.left + 'px' : 'auto',
        right: savedPos ? 'auto' : '20px',
        zIndex: '99999',
        width: '210px',
        padding: '15px',
        background: '#fff',
        border: '2px solid #007bff',
        borderRadius: '10px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
        fontFamily: 'sans-serif',
        userSelect: 'none'
    });
    panel.innerHTML = `
        <h4 id="panelDragHandle" style="margin:0 0 10px;font-size:16px;color:#007bff;text-align:center;cursor:move;touch-action:none;">⠿ 网课自动助手</h4>
        <div style="margin-bottom:12px;">
            <label style="font-size:13px;">倍速: <span id="speedVal">2.0</span>x</label>
            <input type="range" id="speedRange" min="0.5" max="10.0" step="0.5" value="2.0" style="width:100%;">
        </div>
        <div style="margin-bottom:8px;"><label><input type="checkbox" id="muteCheck" checked> 自动静音</label></div>
        <div style="margin-bottom:8px;"><label><input type="checkbox" id="nextCheck" checked> 自动下一节/处理弹窗</label></div>
        <div style="margin-bottom:10px;"><label><input type="checkbox" id="scanCheck" checked> 列表页自动找课</label></div>
        <div id="statusInfo" style="font-size:12px;color:#666;padding-top:8px;border-top:1px solid #eee;text-align:center;">识别中...</div>
    `;
    document.body.appendChild(panel);

    // --- 初始化时 clamp 位置到当前视口 ---
    if (savedPos) {
        const maxLeft = window.innerWidth - panel.offsetWidth;
        const maxTop = window.innerHeight - panel.offsetHeight;
        panel.style.left = Math.max(0, Math.min(savedPos.left, maxLeft)) + 'px';
        panel.style.top = Math.max(0, Math.min(savedPos.top, maxTop)) + 'px';
    }

    // --- 拖拽逻辑（使用 Pointer Events 兼容触屏）---
    const dragHandle = panel.querySelector('#panelDragHandle');
    let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;

    dragHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // 仅响应左键/主指
        isDragging = true;
        dragOffsetX = e.clientX - panel.getBoundingClientRect().left;
        dragOffsetY = e.clientY - panel.getBoundingClientRect().top;
        dragHandle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        let newLeft = e.clientX - dragOffsetX;
        let newTop = e.clientY - dragOffsetY;
        // 边界约束
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panel.offsetWidth));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - panel.offsetHeight));
        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
        panel.style.right = 'auto';
    });

    function endDrag() {
        if (!isDragging) return;
        isDragging = false;
        // 保存位置
        storageSet(POS_KEY, {
            top: parseInt(panel.style.top),
            left: parseInt(panel.style.left)
        });
    }

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    // --- 获取 UI 元素 ---
    const speedRange = panel.querySelector('#speedRange');
    const speedVal = panel.querySelector('#speedVal');
    const statusInfo = panel.querySelector('#statusInfo');
    const muteCheck = panel.querySelector('#muteCheck');
    const nextCheck = panel.querySelector('#nextCheck');
    const scanCheck = panel.querySelector('#scanCheck');

    // --- 从配置恢复 UI 状态 ---
    speedRange.value = config.speed;
    speedVal.innerText = config.speed;
    muteCheck.checked = config.isMuted;
    nextCheck.checked = config.autoNext;
    scanCheck.checked = config.autoScan;

    // --- 绑定事件：更改时保存配置 ---
    speedRange.oninput = () => {
        config.speed = parseFloat(speedRange.value);
        speedVal.innerText = config.speed;
        saveConfig();
    };
    muteCheck.onchange = () => { config.isMuted = muteCheck.checked; saveConfig(); };
    nextCheck.onchange = () => { config.autoNext = nextCheck.checked; saveConfig(); };
    scanCheck.onchange = () => { config.autoScan = scanCheck.checked; saveConfig(); };

    // --- 核心逻辑 ---
    function mainLoop() {
        const video = document.querySelector('video.videoplayer');
        const nextBtn = document.querySelector('.next_chapter');

        // 优先检测场景 B：处理结束弹窗
        // 优先检查 alertbox_group 内的按钮
        let confirmBackBtn = document.querySelector('div.alertbox_group button.theme_2');

        // 如果没找到，尝试查找其他弹窗结构中的确定按钮
        if (!confirmBackBtn) {
            // 查找所有 theme_2 按钮，检查是否在弹窗中
            const allTheme2Btns = document.querySelectorAll('button.theme_2');
            for (let btn of allTheme2Btns) {
                // 检查按钮文本是否为"确定"，且附近有弹窗提示文字
                if (btn.innerText.includes("确定")) {
                    // 检查是否在弹窗容器中（不是笔记区等其他区域）
                    const parent = btn.closest('.alertbox, .layer, .modal, .popup, .dialog, [class*="alert"], [class*="layer"]');
                    if (parent) {
                        confirmBackBtn = btn;
                        break;
                    }
                    // 或者检查页面上是否有"返回课程内容"相关文字
                    if (document.body.innerText.includes("是否返回课程内容") ||
                        document.body.innerText.includes("返回列表")) {
                        confirmBackBtn = btn;
                        break;
                    }
                }
            }
        }

        if (confirmBackBtn && confirmBackBtn.innerText.includes("确定")) {
            statusInfo.innerText = "状态: 正在自动返回列表";

            // 从当前 URL 获取 courseId 和 termId
            const urlParams = new URLSearchParams(window.location.search);
            const courseId = urlParams.get('courseId');
            const termId = urlParams.get('termId');

            if (courseId && termId) {
                const targetUrl = `/pages/learning/videoCourseware.jsp?courseId=${courseId}&termId=${termId}`;
                window.location.href = targetUrl;
            } else {
                // 如果获取不到参数，降级为模拟点击
                simulateClick(confirmBackBtn);
            }
            return;
        }

        // 场景 A：视频播放中
        if (video) {
            statusInfo.innerText = "状态: 正在监控播放器";
            video.muted = muteCheck.checked;
            if (video.playbackRate !== config.speed) video.playbackRate = config.speed;
            if (video.paused && !video.ended) video.play().catch(() => { });

            video.onended = () => {
                if (nextCheck.checked && nextBtn && !nextBtn.disabled) {
                    nextBtn.click();
                }
            };
            return;
        }

        // 场景 C：列表页扫描与自动展开
        if (scanCheck.checked) {
            const statusLabels = document.querySelectorAll('.loadStatus');
            for (let label of statusLabels) {
                if (label.innerText.includes("未完成")) {
                    const chapterHeader = label.closest('.chapter_title_box');
                    if (chapterHeader) {
                        const parent = chapterHeader.parentElement;
                        const contentArea = parent.querySelector('.chapter_content');

                        if (contentArea && (contentArea.style.display === 'none' || getComputedStyle(contentArea).display === 'none')) {
                            statusInfo.innerText = "状态: 正在展开未完成章节...";
                            chapterHeader.click();
                            return;
                        }

                        if (contentArea) {
                            const allPlayIcons = contentArea.querySelectorAll('i.fa-play-circle.video_play_icon');
                            for (let icon of allPlayIcons) {
                                if (icon.style.display !== 'none') {
                                    // 使用模拟点击触发播放
                                    statusInfo.innerText = "状态: 发现未播放任务，正在进入...";
                                    const markerName = 'data-mooc-helper-click-target';
                                    const markerValue = String(Date.now()) + Math.random().toString(16).slice(2);
                                    icon.setAttribute(markerName, markerValue);
                                    const injected = document.createElement('script');
                                    injected.textContent = "(function(){var icon=document.querySelector('[data-mooc-helper-click-target=\"" + markerValue + "\"]');if(!icon)return;var jq=window.jQuery;if(jq&&jq.fn&&typeof jq.fn.triggerHandler==='function'){jq(icon).triggerHandler('click');}else if(jq&&jq.fn&&typeof jq.fn.trigger==='function'){jq(icon).trigger('click');}else if(icon.click){icon.click();}})();";
                                    (document.documentElement || document.body).appendChild(injected);
                                    injected.remove();
                                    icon.removeAttribute(markerName);
                                    return;
                                }
                            }
                        }
                    }
                }
            }
            statusInfo.innerText = "状态: 扫描中/暂无未完任务";
        }
    }

    // 每 2.5 秒执行一次
    setInterval(mainLoop, 2500);

})();
