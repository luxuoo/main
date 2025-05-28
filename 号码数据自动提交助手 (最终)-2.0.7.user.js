// ==UserScript==
// @name         号码数据自动提交助手 (最终)
// @namespace    http://tampermonkey.net/
// @version      2.0.7
// @description  通过导入CSV文件自动提交号码和城市数据。持久化CSV数据和提交状态，防止重复提交，可查看每条CSV记录状态。修复设置面板关闭按钮。
// @author       旭旭
// @match        http://www.haisuoshuju.cn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @require      https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.min.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置区域 ---
    const phoneInputSelector = "input[placeholder='输入手机号码']";
    const primarySubmitSelector = ".sub";
    const submissionDelay = 2000;
    const mainPanelId = 'auto-submit-panel-haisuo-main';
    const historyPanelId = 'auto-submit-panel-haisuo-history';
    const detailsPanelId = 'auto-submit-panel-haisuo-details';
    const settingsPanelId = 'auto-submit-panel-haisuo-settings';

    const historyStorageKey = 'submittedNumbersHistory_csv_v1.9.2';
    const csvDataStorageKey = 'csvImportedData_v1.9.2';
    const csvFileNameStorageKey = 'csvImportedFileName_v1.9.2';
    const csvCurrentIndexStorageKey = 'csvCurrentImportIndex_v1.9.2';
    const vueTargetCountStorageKey = 'targetCount_csv_1.9.2';
    const vueRemainingCountStorageKey = 'remainingCount_csv_1.9.2';
    const vueIsRunningStorageKey = 'isRunning_csv_1.9.2';
    const backupDataVersion = '1.9.8';

    const MAX_LOG_ENTRIES = 200;
    // --- 配置结束 ---

    let historyPanel = null;
    let detailsPanel = null;
    let settingsPanel = null;
    let currentFilteredHistoryForDetails = [];
    let dailyChartInstance = null;
    let logEntries = [];
    let mainPanelTimeUpdater = null;

    function logEvent(message, type = "INFO") {
        const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
        const logEntry = `[${timestamp}] [${type}] ${message}`;
        logEntries.unshift(logEntry);
        if (logEntries.length > MAX_LOG_ENTRIES) {
            logEntries.pop();
        }
        if (historyPanel && historyPanel.querySelector('#logDisplayArea') && historyPanel.querySelector('#logDisplayArea').style.display !== 'none') {
            updateLogDisplay();
        }
    }

    // --- 添加通用样式 ---
    GM_addStyle(`
        .gm-haisuo-panel { position: fixed; background-color: #f8f9fa; border: 1px solid #dee2e6; padding: 8px; z-index: 9990; font-size: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; box-shadow: 0 0.25rem 0.75rem rgba(0,0,0,0.1); border-radius: 0.25rem; display: flex; flex-direction: column; gap: 6px; cursor: move; }
        .gm-haisuo-panel h4 { margin: 0 0 6px 0; padding-bottom: 4px; text-align: center; font-size: 12px; border-bottom: 1px solid #e9ecef; font-weight: 600; }
        .gm-haisuo-panel h5 { margin: 6px 0 4px 0; font-size: 11px; text-align: left; border: none; display: flex; justify-content: space-between; align-items: center; font-weight: 600;}
        .gm-haisuo-panel label { display: block; margin-bottom: 2px; font-weight:normal; font-size: 10px; }
        .gm-haisuo-panel input[type="number"], .gm-haisuo-panel input[type="text"], .gm-haisuo-panel select, .gm-haisuo-panel input[type="date"], .gm-haisuo-panel input[type="file"] { width: 100%; padding: 4px 6px; border: 1px solid #ced4da; border-radius: 0.15rem; box-sizing: border-box; font-size: 10px; margin-bottom: 4px; }
        .gm-haisuo-panel button { padding: 5px 8px; cursor: pointer; width: 100%; border: none; border-radius: 0.15rem; color: white; box-sizing: border-box; transition: background-color 0.2s ease, opacity 0.2s ease; font-size: 10px; margin-bottom: 2px; }
        .gm-haisuo-panel button:disabled { background-color: #6c757d !important; cursor: not-allowed; opacity: 0.65; }
        .gm-haisuo-panel .close-button { position: absolute; top: 4px; right: 6px; background: none; border: none; color: #6c757d; font-size: 16px; cursor: pointer; padding: 0; width: auto; line-height: 1; opacity: 0.7; }
        .gm-haisuo-panel .close-button:hover { color: #000; opacity: 1; }
        .gm-haisuo-panel .copyright { font-size: 8px; color: #6c757d; margin-top: auto; border-top: 1px solid #eee; padding-top: 4px; text-align: center; }

        #${mainPanelId} { top: 50px; right: 10px; width: 230px; z-index: 9999; display: none; }
        #${mainPanelId} .start-button { background-color: #28a745; }
        #${mainPanelId} .pause-button { background-color: #ffc107; color: #212529 !important; }
        #${mainPanelId} .history-toggle-button { background-color: #007bff; margin-top: 2px; }
        #${mainPanelId} .settings-toggle-button { background-color: #6c757d; margin-top: 2px; }
        #${mainPanelId} .status { font-weight: bold; }
        #${mainPanelId} .todays-count { font-size: 9px; color: #17a2b8; margin-top: 2px; text-align: center; }
        #${mainPanelId} .current-time { font-size: 8px; color: #6c757d; text-align: center; margin-top: 4px; padding-top: 2px; border-top: 1px dashed #eee; }
        #${mainPanelId} .csv-info { font-size: 8px; color: #28a745; margin-top: -2px; margin-bottom: 2px; text-align: left; line-height: 1.2; word-break: break-all; }
        #${mainPanelId} .csv-info.error { color: #dc3545; }
        #${mainPanelId} > div:not(:last-child):not(.copyright):not(.current-time) { margin-bottom: 4px; }

        #${settingsPanelId} { top: 50px; right: 250px; width: 230px; z-index: 9998; display: none; }
        #${settingsPanelId} .clear-csv-button { background-color: #dc3545; }
        #${settingsPanelId} .backup-button { background-color: #6f42c1; }
        #${settingsPanelId} .restore-label { margin-top: 4px; margin-bottom: 1px; }


        #${historyPanelId} { top: 50px; right: 490px; width: 360px; z-index: 9995; display: none; padding: 10px; gap: 8px;}
        #${historyPanelId} .tab-controls { display: flex; justify-content: space-around; margin-bottom: 8px; border-bottom: 1px solid #dee2e6; padding-bottom: 6px;}
        #${historyPanelId} .tab-controls button { font-size:10px; padding: 4px 7px; margin-bottom:0; width: auto; background-color: #6c757d; opacity:0.7; }
        #${historyPanelId} .tab-controls button.active { background-color: #007bff; opacity:1; font-weight:bold;}
        #${historyPanelId} .tab-content { display: none; padding-top: 5px; }
        #${historyPanelId} .tab-content.active { display: block; }
        #${historyPanelId} #statsContent .stats-view-toggle { display: flex; justify-content: flex-end; margin-bottom: 4px; }
        #${historyPanelId} #statsContent .stats-view-toggle button { width: auto; font-size: 9px; padding: 3px 6px; margin-left: 4px; background-color: #6c757d; opacity: 0.8; }
        #${historyPanelId} #statsContent .stats-view-toggle button.active { background-color: #007bff; opacity: 1; font-weight: bold; }
        #${historyPanelId} .chart-title-custom { text-align: center; font-size: 10px; color: #333; margin-bottom: 2px;}
        #${historyPanelId} #dailyChartCanvasContainer { position: relative; height: 140px; margin: 4px 0; border: 1px solid #ced4da; background: #fff; border-radius: .2rem; }
        #${historyPanelId} #dailyCountsList { max-height: 140px; font-size:9px; padding: 5px 7px; margin: 4px 0; list-style-type: none; background: #fff; border: 1px solid #ced4da; border-radius: 0.2rem; word-break: break-word; }
        #${historyPanelId} #logDisplayArea { max-height: 140px; font-size:8px; padding: 5px; background: #e9ecef; border: 1px solid #ced4da; border-radius: .2rem; white-space: pre-wrap; word-break: break-all; margin: 4px 0; overflow-y: auto; }
        #${historyPanelId} #logDisplayArea div { word-break: break-all; overflow-wrap: break-word; }
        #${historyPanelId} .action-buttons { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
        #${historyPanelId} .action-buttons button { font-size: 10px; padding: 5px 8px; width: 100%; }

        #${historyPanelId} #statsContent .action-buttons .view-details-button { background-color: #17a2b8; color:white;}
        #${historyPanelId} #statsContent .action-buttons .export-csv-button { background-color: #28a745; color:white;}
        #${historyPanelId} #statsContent .action-buttons .clear-history-button { background-color: #dc3545; color:white;}

        #${historyPanelId} #csvStatusContent .action-buttons #refreshCsvStatusBtn { background-color:#17a2b8; color:white;}

        #${historyPanelId} #logContent .action-buttons .export-log-button { background-color: #007bff; color:white;}

        #${historyPanelId} #csvStatusContent table { font-size: 9px; width: 100%; border-collapse: collapse; }
        #${historyPanelId} #csvStatusContent th, #${historyPanelId} #csvStatusContent td { padding: 3px 4px; word-break: break-word; border: 1px solid #ddd; }
        #${historyPanelId} #csvStatusContent th { background-color: #f2f2f2; text-align: left;}
        #${historyPanelId} #csvStatusContent td.status-submitted { color: green !important; font-weight: bold !important; }
        #${historyPanelId} #csvStatusContent td.status-pending { color: orange !important; }
        #${historyPanelId} #csvStatusListContainer { max-height: 150px; overflow-y: auto; border: 1px solid #ced4da; border-radius: 0.2rem; margin: 4px 0;}


        #${detailsPanelId} { top: 70px; left: 120px; width: 340px; max-height: 400px; z-index: 10000; }
        #${detailsPanelId} input[type="date"] { font-size: 10px; padding: 4px 6px; }
        #${detailsPanelId} .date-selector-area button#confirmDateBtn { font-size: 10px; padding: 4px 6px; background-color: #007bff; color: white; width: auto; }
        #${detailsPanelId} .details-content { font-size: 10px; max-height: 300px; overflow-y: auto; }
        #${detailsPanelId} #numbersForDateList ul { padding-left: 15px; margin: 5px 0; list-style-type: none; }
        #${detailsPanelId} #numbersForDateList li { margin-bottom: 3px; word-break: break-all; overflow-wrap: break-word; line-height: 1.3; }
    `);

    // --- Pre-fetch GM_values before Vue initialization ---
    const initialTargetCount = GM_getValue(vueTargetCountStorageKey, 10);
    const initialRemainingCount = GM_getValue(vueRemainingCountStorageKey, 10);
    const initialIsRunning = GM_getValue(vueIsRunningStorageKey, false);
    const initialPersistedCsvFileNameForHint = GM_getValue(csvFileNameStorageKey, '');


    // --- 创建主悬浮窗口 HTML ---
    const mainPanelDiv = document.createElement('div');
    mainPanelDiv.id = mainPanelId;
    mainPanelDiv.classList.add('gm-haisuo-panel');
    mainPanelDiv.innerHTML = `
        <button class="close-button" title="关闭面板" @click="closeMainPanel">&times;</button>
        <h4>自动提交助手 v2.0.7</h4>
        <div>
            <label for="csvFileInput">选择CSV文件:</label>
            <input type="file" id="csvFileInput" @change="handleFileUpload" accept=".csv" :disabled="isRunning">
            <div class="csv-info" v-if="csvFileName">已加载: {{ csvFileName }} ({{ importedData.length }} 条)</div>
            <div class="csv-info error" v-if="!csvFileName && persistedCsvFileNameForHint">提醒: 上次加载的CSV数据仍在。</div>
            <div class="csv-info" v-if="importedData.length > 0">待处理: {{ pendingCsvEntriesCount }} / 总计: {{ importedData.length }}</div>
        </div>
        <div>
            <label for="targetCountInput">本次提交数量:</label>
            <input type="number" id="targetCountInput" v-model.number="targetCount" min="0" :disabled="isRunning">
        </div>
        <div>状态: <span :class="statusClass" class="status">{{ statusText }}</span></div>
        <div>剩余 (本次): <span id="remainingCountDisplay">{{ remainingCount }}</span></div>
        <div class="todays-count">今日已提交 (历史): <span>{{ todaySubmissionCount }}</span> 条</div>
        <button :class="runButtonClass" @click="toggleRun">{{ runButtonText }}</button>
        <button class="history-toggle-button" @click="toggleHistoryPanel">历史/日志/CSV状态</button>
        <button class="settings-toggle-button" @click="toggleSettingsPanel">数据管理/设置</button>
        <div class="current-time">{{ currentTime }}</div>
        <div class="copyright">版权所有，仅供学习交流 (作者：旭)</div>
    `;
    document.body.appendChild(mainPanelDiv);
    logEvent("主控制面板已创建并添加到页面。");

    // --- Vue 实例控制主面板 ---
    const app = new Vue({
        el: `#${mainPanelId}`,
        data: {
            targetCount: initialTargetCount,
            remainingCount: initialRemainingCount,
            isRunning: initialIsRunning,
            persistedCsvFileNameForHint: initialPersistedCsvFileNameForHint,
            statusText: '空闲',
            timeoutId: null,
            isPanelVisible: true,
            _historyCache: [],
            todaySubmissionCount: 0,
            currentTime: new Date().toLocaleString('zh-CN', { hour12: false }),
            importedData: [],
            currentImportIndex: 0,
            csvFileName: ''
        },
        computed: {
            runButtonText() { return this.isRunning ? '暂停' : '开始'; },
            runButtonClass() { return this.isRunning ? 'pause-button' : 'start-button'; },
            statusClass() { if (this.isRunning) return 'status-running'; const pendingCount = this.pendingCsvEntriesCount; if (!this.isRunning && this.importedData.length > 0) { if (pendingCount === 0) return 'status-stopped'; if (this.targetCount > 0 && this.remainingCount <= 0) return 'status-paused'; if (GM_getValue(vueIsRunningStorageKey, false) && this.remainingCount > 0) return 'status-paused'; } return 'status-idle'; },
            pendingCsvEntriesCount() { return this.importedData.filter(item => item.status === 'pending').length; }
        },
        watch: {
            targetCount(newVal) { GM_setValue(vueTargetCountStorageKey, newVal); if (!this.isRunning) { this.calculateRemainingForNewRun(); GM_setValue(vueRemainingCountStorageKey, this.remainingCount); this.updateStatusText(); logEvent(`提交数量目标已更改为: ${newVal}`); } },
            isRunning(newVal, oldVal) { GM_setValue(vueIsRunningStorageKey, newVal); this.updateStatusText(); if (newVal === true && oldVal === false) { logEvent("脚本状态变为: 运行中"); GM_setValue(vueRemainingCountStorageKey, this.remainingCount); this.attemptSubmit(); } else if (newVal === false) { logEvent("脚本状态变为: 暂停/停止"); if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = null; } GM_setValue(vueRemainingCountStorageKey, this.remainingCount); } },
            importedData: { handler() { if (historyPanel && historyPanel.querySelector('#csvStatusContent')?.classList.contains('active')) { updateCsvStatusPanelDisplay(); } this.persistedCsvFileNameForHint = GM_getValue(csvFileNameStorageKey, ''); }, deep: true },
            csvFileName(newVal) { this.persistedCsvFileNameForHint = newVal; }
        },
        methods: {
            calculateRemainingForNewRun() { const pendingCount = this.pendingCsvEntriesCount; if (this.targetCount > 0) { this.remainingCount = Math.min(this.targetCount, pendingCount); } else { this.remainingCount = pendingCount; } if (this.remainingCount < 0) this.remainingCount = 0; },
            closeMainPanel() { this.isPanelVisible = false; this.$el.style.display = 'none'; logEvent("主控制面板已关闭。"); if(mainPanelTimeUpdater) clearInterval(mainPanelTimeUpdater); if(settingsPanel) settingsPanel.style.display = 'none'; },
            toggleRun() { if (!this.isRunning) { if (this.importedData.length === 0) { alert('请先导入CSV数据文件！'); logEvent("尝试开始，但没有导入CSV数据。", "WARN"); return; } if (this.pendingCsvEntriesCount === 0) { alert('所有导入的CSV数据已处理完毕。'); logEvent("尝试开始，但所有CSV数据已处理。", "INFO"); return; } if (this.remainingCount <= 0) { this.calculateRemainingForNewRun(); logEvent(`准备新的提交轮次。计划提交: ${this.remainingCount} 条。`); } else { let capForResume = this.pendingCsvEntriesCount; if (this.targetCount > 0) { capForResume = Math.min(capForResume, this.targetCount); } this.remainingCount = Math.min(this.remainingCount, capForResume); if (this.remainingCount < 0) this.remainingCount = 0; logEvent(`恢复已暂停的提交轮次。计划提交: ${this.remainingCount} 条。`); } if (this.remainingCount <= 0) { alert('没有可提交的数据。'); logEvent("尝试开始，但计算后无数据可提交。", "INFO"); return; } } this.isRunning = !this.isRunning; },
            updateStatusText() { if (this.isRunning) { this.statusText = '运行中...'; } else { const pendingCount = this.pendingCsvEntriesCount; if (pendingCount === 0 && this.importedData.length > 0) { this.statusText = 'CSV已全部处理'; } else if (this.targetCount > 0 && this.remainingCount <= 0 && this.importedData.length > 0) { this.statusText = '本次完成'; } else if (GM_getValue(vueIsRunningStorageKey, false)) { this.statusText = '已暂停'; } else { this.statusText = '空闲'; } } },
            loadPersistedCSVData() { const storedData = GM_getValue(csvDataStorageKey, null); this.csvFileName = GM_getValue(csvFileNameStorageKey, ''); this.persistedCsvFileNameForHint = this.csvFileName; this.currentImportIndex = GM_getValue(csvCurrentIndexStorageKey, 0); if (storedData && Array.isArray(storedData)) { this.importedData = storedData; logEvent(`从本地存储恢复了CSV数据: ${this.csvFileName} (${this.importedData.length}条), 下次搜索起始索引: ${this.currentImportIndex}`); } else { this.importedData = []; logEvent("未找到本地存储的CSV数据。"); } this.calculateRemainingForNewRun(); this.updateStatusText(); },
            clearPersistedCSVData() { if (confirm("确定要清除所有已缓存的CSV导入数据和提交进度吗？此操作不可恢复。")) { GM_setValue(csvDataStorageKey, null); GM_setValue(csvFileNameStorageKey, ''); GM_setValue(csvCurrentIndexStorageKey, 0); this.importedData = []; this.csvFileName = ''; this.currentImportIndex = 0; this.persistedCsvFileNameForHint = ''; this.calculateRemainingForNewRun(); GM_setValue(vueRemainingCountStorageKey, this.remainingCount); this.updateStatusText(); logEvent("已清除缓存的CSV数据和进度。", "WARN"); alert("缓存的CSV数据已清除。"); if (historyPanel && historyPanel.querySelector('#csvStatusContent')?.classList.contains('active')) { updateCsvStatusPanelDisplay(); } } },
            handleFileUpload(event) { const file = event.target.files[0]; const csvInput = event.target; if (file) { const reader = new FileReader(); reader.onload = (e) => { this.parseCSVAndStore(e.target.result, file.name); if(csvInput) csvInput.value = ''; }; reader.onerror = (e) => { logEvent(`读取文件 "${file.name}" 失败: ${e.target.error}`, "ERROR"); alert(`读取文件 "${file.name}" 失败!`); if(csvInput) csvInput.value = ''; }; reader.readAsText(file); logEvent(`选择新CSV文件: ${file.name}`); } },
            parseCSVAndStore(csvContent, fileName) { const newImportedData = []; let duplicatesMarked = 0; try { const lines = csvContent.split(/\r\n|\n/); if (lines.length <= 1 && !(lines.length === 1 && lines[0].trim() !== '')) { logEvent("CSV文件为空或只有表头。", "WARN"); alert("CSV文件为空或格式不正确。"); return; } for (let i = 1; i < lines.length; i++) { const line = lines[i].trim(); if (line === "") continue; const parts = line.split(','); if (parts.length >= 2) { const city = parts[0].trim(); const number = parts[1].trim(); if (city && number) { let initialStatus = 'pending'; if (this._historyCache.some(histEntry => histEntry.phoneNumber === number)) { initialStatus = 'submitted'; duplicatesMarked++; logEvent(`导入CSV: 号码 ${number} 在历史记录中找到, 自动标记为已提交。`, "INFO"); } newImportedData.push({ id: `${fileName}|${i-1}|${city}|${number}`, city: city, number: number, status: initialStatus, originalIndex: i - 1 }); } else { logEvent(`CSV第 ${i + 1} 行数据不完整，已跳过: "${line}"`, "WARN"); } } else { logEvent(`CSV第 ${i + 1} 行格式不正确，已跳过: "${line}"`, "WARN"); } } if (newImportedData.length > 0) { this.importedData = newImportedData; this.csvFileName = fileName; this.currentImportIndex = 0; this.persistedCsvFileNameForHint = fileName; GM_setValue(csvDataStorageKey, this.importedData); GM_setValue(csvFileNameStorageKey, this.csvFileName); GM_setValue(csvCurrentIndexStorageKey, this.currentImportIndex); logEvent(`新CSV文件已加载: ${this.csvFileName}, ${this.importedData.length} 条数据。其中 ${duplicatesMarked} 条因重复被自动标记。`); alert(`成功导入 ${this.importedData.length} 条数据从 ${this.csvFileName}。\n其中 ${duplicatesMarked} 条因在历史记录中重复而被自动标记为已提交。`); } else { logEvent("新CSV文件解析完毕，但未找到有效数据。", "WARN"); alert("新CSV文件未包含有效数据行。"); } } catch (error) { logEvent(`解析CSV文件内容时出错: ${error.message}`, "ERROR"); alert(`解析CSV文件失败: ${error.message}`); } this.calculateRemainingForNewRun(); GM_setValue(vueRemainingCountStorageKey, this.remainingCount); this.updateStatusText(); },
            findSubmitButtonRobust() { let btn; logEvent(`尝试查找提交按钮: 主要选择器 "${primarySubmitSelector}"`); btn = document.querySelector(primarySubmitSelector); if (btn) { logEvent("通过主要选择器找到按钮。"); return btn; } const commonSelectors = ['#submit', '#sub', 'button[type="submit"]', '.submit-button', '.el-button--primary']; for (const selector of commonSelectors) { logEvent(`尝试备选选择器: "${selector}"`); btn = document.querySelector(selector); if (btn) { logEvent("通过备选选择器找到按钮。"); return btn; } } logEvent("尝试通过文本 '提交' 查找按钮..."); const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn'); for (let i = 0; i < buttons.length; i++) { const buttonText = (buttons[i].textContent || buttons[i].innerText || buttons[i].value || '').trim(); if (buttonText === '提交') { logEvent("通过文本 '提交' 找到按钮。"); if (buttons[i].offsetParent !== null && !buttons[i].disabled) { return buttons[i]; } else { logEvent("找到文本匹配的按钮，但可能不可见或禁用，继续查找...", "WARN"); } } } logEvent("所有方法都未能找到提交按钮！", "ERROR"); return null; },
            getFormattedDate(timestamp) { const d = new Date(timestamp || Date.now()); const year = d.getFullYear(); const month = ('0' + (d.getMonth() + 1)).slice(-2); const day = ('0' + d.getDate()).slice(-2); return `${year}-${month}-${day}`; },
            updateTodaySubmissionCount() { const todayStr = this.getFormattedDate(); this.todaySubmissionCount = this._historyCache.filter(entry => entry.date === todayStr).length; logEvent(`今日已提交数量更新为: ${this.todaySubmissionCount}`); },
            saveHistoryEntry(phoneNumber, city) { const now = new Date().getTime(); const entry = { phoneNumber: phoneNumber, city: city, timestamp: now, date: this.getFormattedDate(now) }; this._historyCache.unshift(entry); GM_setValue(historyStorageKey, this._historyCache); logEvent(`历史记录已保存: ${phoneNumber} (${city})`); this.updateTodaySubmissionCount(); if (historyPanel && historyPanel.style.display !== 'none' && historyPanel.querySelector('#statsContent').classList.contains('active')) { updateHistoryPanelDisplay(historyPanel.querySelector('#showChartViewBtn')?.classList.contains('active')); } },
            loadHistory() { this._historyCache = GM_getValue(historyStorageKey, []); logEvent(`已加载 ${this._historyCache.length} 条历史记录到缓存。`); this.updateTodaySubmissionCount(); },
            attemptSubmit(retryCount = 0) { const MAX_RETRIES = 5; const RETRY_DELAY = 300; if (!this.isRunning || this.remainingCount <= 0) { logEvent("提交中止：未运行或本次提交数量已达标。"); if (this.isRunning && this.remainingCount <= 0) { this.isRunning = false; } this.updateStatusText(); return; } let itemToSubmit = null; let itemActualIndex = -1; for (let i = this.currentImportIndex; i < this.importedData.length; i++) { if (this.importedData[i] && this.importedData[i].status === 'pending') { itemToSubmit = this.importedData[i]; itemActualIndex = i; break; } } if (!itemToSubmit) { logEvent("提交中止：CSV中无更多待处理项。脚本已停止。", "INFO"); this.isRunning = false; this.calculateRemainingForNewRun(); GM_setValue(vueRemainingCountStorageKey, this.remainingCount); this.updateStatusText(); return; } logEvent(`尝试提交 (第 ${retryCount + 1} 次): ${itemToSubmit.number} (${itemToSubmit.city}) - CSV原始行 ${itemToSubmit.originalIndex + 1}`); let phoneInput = document.querySelector(phoneInputSelector); let submitButton = this.findSubmitButtonRobust(); if (!phoneInput || !submitButton) { if (retryCount < MAX_RETRIES) { logEvent(`元素未就绪 (尝试 ${retryCount + 1}/${MAX_RETRIES})，将在 ${RETRY_DELAY}ms 后重试...`, "WARN"); if (this.timeoutId) clearTimeout(this.timeoutId); this.timeoutId = setTimeout(() => { this.attemptSubmit(retryCount); }, RETRY_DELAY); } else { logEvent(`错误：元素查找失败，已达最大重试次数 (${MAX_RETRIES})。脚本已停止。`, "ERROR"); if (!phoneInput) alert(`脚本错误：找不到电话输入框 (${phoneInputSelector})。`); if (!submitButton) alert(`脚本错误：无法找到“提交”按钮。`); this.isRunning = false; this.updateStatusText(); } return; } logEvent("页面元素已找到，准备执行提交操作..."); phoneInput.value = itemToSubmit.number; phoneInput.dispatchEvent(new Event('input', { bubbles: true })); phoneInput.dispatchEvent(new Event('change', { bubbles: true })); itemToSubmit.status = 'submitted'; this.saveHistoryEntry(itemToSubmit.number, itemToSubmit.city); this.currentImportIndex = itemActualIndex + 1; GM_setValue(csvDataStorageKey, this.importedData); GM_setValue(csvCurrentIndexStorageKey, this.currentImportIndex); this.remainingCount--; GM_setValue(vueRemainingCountStorageKey, this.remainingCount); this.updateStatusText(); logEvent(`点击提交按钮。本次剩余 ${this.remainingCount} 次。CSV总待处理: ${this.pendingCsvEntriesCount}`); if (document.body.contains(submitButton) && !submitButton.disabled) { submitButton.click(); logEvent("提交点击已执行。"); } else { logEvent("提交按钮在点击前状态发生变化，本次提交可能失败。脚本已暂停。", "WARN"); this.isRunning = false; itemToSubmit.status = 'pending'; GM_setValue(csvDataStorageKey, this.importedData); this.remainingCount++; GM_setValue(vueRemainingCountStorageKey, this.remainingCount); alert("提交时发生错误，按钮状态异常，脚本已暂停。请检查页面。"); this.updateStatusText(); return; } if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = null; } if (this.isRunning && this.remainingCount > 0 && this.pendingCsvEntriesCount > 0) { this.timeoutId = setTimeout(() => this.attemptSubmit(), submissionDelay); } else if (this.isRunning) { this.isRunning = false; logEvent(this.pendingCsvEntriesCount === 0 ? "所有CSV数据已处理完毕。" : "本次提交任务已完成。"); this.updateStatusText(); } },
            toggleHistoryPanel() { if (!historyPanel) createHistoryPanel(); if (historyPanel) { const isVisible = historyPanel.style.display !== 'none'; if (isVisible) { historyPanel.style.display = 'none'; if(detailsPanel) closeDetailsPanel(); if(dailyChartInstance) {dailyChartInstance.destroy(); dailyChartInstance = null;} logEvent("历史/日志/CSV状态面板已关闭。"); } else { let activeTabId = 'statsContent'; const activeTabButton = historyPanel.querySelector('.tab-controls button.active'); if (activeTabButton) {activeTabId = activeTabButton.dataset.tab;} else { const defaultTabButton = historyPanel.querySelector('button[data-tab="statsContent"]'); if(defaultTabButton) defaultTabButton.classList.add('active');} setActiveTab(activeTabId); historyPanel.style.display = 'flex'; logEvent("历史/日志/CSV状态面板已打开。"); } } },
            toggleSettingsPanel() {
                if (!settingsPanel) createSettingsPanel();
                if (settingsPanel) {
                    const isVisible = settingsPanel.style.display !== 'none';
                    settingsPanel.style.display = isVisible ? 'none' : 'flex';
                    logEvent(`数据管理/设置面板已${isVisible ? '关闭' : '打开'}。`);
                }
            },
            closeSettingsPanel() {
                if (settingsPanel) {
                    settingsPanel.style.display = 'none';
                    logEvent("数据管理/设置面板已通过关闭按钮关闭。");
                }
            },
            exportBackupData() { const backup = { version: backupDataVersion, timestamp: new Date().toISOString(), data: { [historyStorageKey]: GM_getValue(historyStorageKey, []), [csvDataStorageKey]: GM_getValue(csvDataStorageKey, null), [csvFileNameStorageKey]: GM_getValue(csvFileNameStorageKey, ''), [csvCurrentIndexStorageKey]: GM_getValue(csvCurrentIndexStorageKey, 0), [vueTargetCountStorageKey]: GM_getValue(vueTargetCountStorageKey, 10), [vueRemainingCountStorageKey]: GM_getValue(vueRemainingCountStorageKey, 10), [vueIsRunningStorageKey]: GM_getValue(vueIsRunningStorageKey, false) } }; const jsonString = JSON.stringify(backup, null, 2); const blob = new Blob([jsonString], {type: "application/json"}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `haisuo_helper_backup_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); logEvent("数据已备份导出。"); alert("数据备份已导出！"); },
            handleRestoreFile(event) { const file = event.target.files[0]; const restoreInput = event.target; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { try { const backup = JSON.parse(e.target.result); if (!backup || !backup.data || backup.version !== backupDataVersion) { alert(`恢复失败：文件格式不正确或版本不兼容 (需要版本 ${backupDataVersion})。`); logEvent(`恢复失败：文件格式或版本不兼容。文件版本: ${backup.version}`, "ERROR"); if(restoreInput) restoreInput.value = ''; return; } const dataToRestore = backup.data; GM_setValue(historyStorageKey, dataToRestore[historyStorageKey] || []); GM_setValue(csvDataStorageKey, dataToRestore[csvDataStorageKey] || null); GM_setValue(csvFileNameStorageKey, dataToRestore[csvFileNameStorageKey] || ''); GM_setValue(csvCurrentIndexStorageKey, dataToRestore[csvCurrentIndexStorageKey] || 0); GM_setValue(vueTargetCountStorageKey, dataToRestore[vueTargetCountStorageKey] || 10); GM_setValue(vueRemainingCountStorageKey, dataToRestore[vueRemainingCountStorageKey] || 10); GM_setValue(vueIsRunningStorageKey, dataToRestore[vueIsRunningStorageKey] || false); this.targetCount = GM_getValue(vueTargetCountStorageKey, 10); this.remainingCount = GM_getValue(vueRemainingCountStorageKey, 10); this.isRunning = GM_getValue(vueIsRunningStorageKey, false); this.loadHistory(); this.loadPersistedCSVData(); alert("数据恢复成功！请检查面板数据。"); logEvent("数据已从备份文件恢复。"); } catch (err) { alert(`恢复失败：无法解析备份文件。错误: ${err.message}`); logEvent(`恢复失败：解析备份文件错误: ${err.message}`, "ERROR"); } finally { if(restoreInput) restoreInput.value = ''; } }; reader.readAsText(file); }
        },
        mounted() { this.loadHistory(); this.loadPersistedCSVData(); this.remainingCount = initialRemainingCount; let capByPending = this.pendingCsvEntriesCount; this.remainingCount = Math.min(this.remainingCount, capByPending); if (this.remainingCount <= 0 && this.targetCount > 0 && this.pendingCsvEntriesCount > 0) { this.calculateRemainingForNewRun(); } else if (this.remainingCount < 0) { this.remainingCount = 0; } GM_setValue(vueRemainingCountStorageKey, this.remainingCount); logEvent(`自动提交助手 v2.0.7 (CSV导入增强版) 已加载并初始化。`); this.$el.style.display = 'flex'; mainPanelTimeUpdater = setInterval(() => { this.currentTime = new Date().toLocaleString('zh-CN', { hour12: false }); }, 1000); if (this.isRunning) { if (this.remainingCount > 0 && this.pendingCsvEntriesCount > 0) { logEvent(`检测到脚本应处于运行状态 (剩余 ${this.remainingCount} 次,待处理 ${this.pendingCsvEntriesCount} 条)，将在 ${submissionDelay}ms 后尝试提交...`); if (this.timeoutId) clearTimeout(this.timeoutId); this.timeoutId = setTimeout(() => { this.attemptSubmit(); }, submissionDelay); } else { logEvent("检测到脚本状态为运行，但无剩余次数或无待处理CSV项。脚本已停止。"); this.isRunning = false; GM_setValue(vueIsRunningStorageKey, false); } } this.updateStatusText(); makeDraggable(this.$el);
            window.haisuoAppClearPersistedCSVData = this.clearPersistedCSVData; // For settings panel button
            window.haisuoAppExportBackupData = this.exportBackupData; // For settings panel button
            // window.haisuoAppCloseSettingsPanel is no longer needed as it's handled by direct event listener
        },
        beforeDestroy() { if (mainPanelTimeUpdater) clearInterval(mainPanelTimeUpdater); if (this.timeoutId) clearTimeout(this.timeoutId); delete window.haisuoAppClearPersistedCSVData; delete window.haisuoAppExportBackupData; }
    });

    // --- 设置面板相关函数 ---
    function createSettingsPanel() {
        if (document.getElementById(settingsPanelId)) {
            settingsPanel = document.getElementById(settingsPanelId);
            return;
        }
        settingsPanel = document.createElement('div');
        settingsPanel.id = settingsPanelId;
        settingsPanel.classList.add('gm-haisuo-panel');
        settingsPanel.style.display = 'none';
        settingsPanel.innerHTML = `
            <button class="close-button" title="关闭设置面板">&times;</button> <h4>数据管理/设置</h4>
            <button class="clear-csv-button" onclick="window.haisuoAppClearPersistedCSVData()" title="清除已存储的CSV数据和提交进度">清除缓存CSV数据</button>
            <button class="backup-button" onclick="window.haisuoAppExportBackupData()" title="备份所有脚本数据">备份数据</button>
            <div>
                <label for="restoreFileInputSettingsPanel" class="restore-label">恢复备份数据:</label>
                <input type="file" id="restoreFileInputSettingsPanel" accept=".json">
            </div>
        `;
        document.body.appendChild(settingsPanel);
        makeDraggable(settingsPanel);
        logEvent("设置面板DOM已创建。");

        // Add event listener for the close button directly to the Vue instance method
        const closeBtn = settingsPanel.querySelector('.close-button');
        if(closeBtn) {
            closeBtn.addEventListener('click', app.closeSettingsPanel);
        }

        const restoreInput = settingsPanel.querySelector('#restoreFileInputSettingsPanel');
        if (restoreInput) {
            restoreInput.addEventListener('change', (event) => app.handleRestoreFile(event));
        }
    }


    // --- 历史记录、日志、CSV状态面板相关函数 ---
    function createHistoryPanel() { if (document.getElementById(historyPanelId)) return; historyPanel = document.createElement('div'); historyPanel.id = historyPanelId; historyPanel.classList.add('gm-haisuo-panel'); historyPanel.style.display = 'none'; historyPanel.innerHTML = ` <button class="close-button" title="关闭此面板">&times;</button> <div class="tab-controls"> <button data-tab="statsContent" class="active">历史统计</button> <button data-tab="csvStatusContent">CSV导入状态</button> <button data-tab="logContent">运行日志</button> </div> <div id="statsContent" class="tab-content active"> <h5>提交历史统计 <span id="statsTitleInfo"></span> <span class="stats-view-toggle"> <button id="showListViewBtn" class="active">列表</button> <button id="showChartViewBtn">图表</button> </span> </h5> <input type="text" id="historySearchInput" placeholder="实时搜索号码/城市/日期..."> <div class="chart-title-custom" id="dailyChartTitle" style="display:none;">每日提交数量</div> <div id="dailyChartCanvasContainer" style="display: none;"> <canvas id="dailyChartCanvas"></canvas> </div> <ul id="dailyCountsList"><li>请搜索或等待数据加载...</li></ul> <div class="action-buttons"> <button class="view-details-button">查看详细记录</button> <button class="export-csv-button">导出历史 (CSV)</button> <button class="clear-history-button">清空所有历史</button> </div> </div> <div id="csvStatusContent" class="tab-content"> <h5>当前CSV文件提交状态 (<span id="csvStatusFileName">未加载</span>)</h5> <div id="csvStatusListContainer"> <table id="csvStatusTable"> <thead><tr><th>#</th><th>城市</th><th>号码</th><th>状态</th></tr></thead> <tbody><tr><td colspan="4" style="text-align:center;">没有加载CSV数据或数据为空。</td></tr></tbody> </table> </div> <div class="action-buttons"> <button id="refreshCsvStatusBtn">刷新状态列表</button> </div> </div> <div id="logContent" class="tab-content"> <h5>运行日志 (最近 ${MAX_LOG_ENTRIES} 条)</h5> <div id="logDisplayArea">加载中...</div> <div class="action-buttons"> <button class="export-log-button">导出日志 (TXT)</button> </div> </div> `; document.body.appendChild(historyPanel); logEvent("历史/日志/CSV状态面板DOM已创建。"); const tabButtons = historyPanel.querySelectorAll('.tab-controls button'); tabButtons.forEach(button => { button.addEventListener('click', () => setActiveTab(button.dataset.tab) ); }); historyPanel.querySelector('#refreshCsvStatusBtn').addEventListener('click', updateCsvStatusPanelDisplay); historyPanel.querySelector('.close-button').addEventListener('click', () => { historyPanel.style.display = 'none'; if(detailsPanel) closeDetailsPanel(); if(dailyChartInstance) {dailyChartInstance.destroy(); dailyChartInstance = null;} logEvent("历史/日志/CSV状态面板已通过关闭按钮关闭。"); }); historyPanel.querySelector('#historySearchInput').addEventListener('input', () => { if(historyPanel.querySelector('#statsContent').classList.contains('active')) updateHistoryPanelDisplay(historyPanel.querySelector('#showChartViewBtn').classList.contains('active')); }); historyPanel.querySelector('.view-details-button').addEventListener('click', showDetailedHistoryPanel); historyPanel.querySelector('.clear-history-button').addEventListener('click', clearHistory); historyPanel.querySelector('.export-csv-button').addEventListener('click', exportHistoryToCsv); historyPanel.querySelector('.export-log-button').addEventListener('click', exportLogsToTxt); const listViewBtn = historyPanel.querySelector('#showListViewBtn'); const chartViewBtn = historyPanel.querySelector('#showChartViewBtn'); listViewBtn.addEventListener('click', () => { toggleStatsView(false); }); chartViewBtn.addEventListener('click', () => { toggleStatsView(true); }); makeDraggable(historyPanel); }
    function toggleStatsView(showChart) { if (!historyPanel) return; const chartContainer = historyPanel.querySelector('#dailyChartCanvasContainer'); const chartTitleEl = historyPanel.querySelector('#dailyChartTitle'); const countsList = historyPanel.querySelector('#dailyCountsList'); const listViewBtn = historyPanel.querySelector('#showListViewBtn'); const chartViewBtn = historyPanel.querySelector('#showChartViewBtn'); if(!chartContainer || !chartTitleEl || !countsList || !listViewBtn || !chartViewBtn) { logEvent("toggleStatsView: One or more elements not found in historyPanel.", "ERROR"); return; } chartContainer.style.display = showChart ? 'block' : 'none'; chartTitleEl.style.display = showChart ? 'block' : 'none'; countsList.style.display = showChart ? 'none' : 'block'; listViewBtn.classList.toggle('active', !showChart); chartViewBtn.classList.toggle('active', showChart); if (showChart) { updateHistoryPanelDisplay(true); } else { if(dailyChartInstance) {dailyChartInstance.destroy(); dailyChartInstance = null;} updateHistoryPanelDisplay(false); } logEvent(`历史统计视图切换到: ${showChart ? '图表' : '列表'}`); }
    function updateCsvStatusPanelDisplay() { logEvent("更新CSV导入状态面板显示。"); if (!historyPanel) return; const statusTableBody = historyPanel.querySelector('#csvStatusTable tbody'); const fileNameSpan = historyPanel.querySelector('#csvStatusFileName'); if (!statusTableBody || !fileNameSpan) { logEvent("updateCsvStatusPanelDisplay: Table body or file name span not found.", "ERROR"); return; } fileNameSpan.textContent = app.csvFileName || "未加载"; if (!app.importedData || app.importedData.length === 0) { statusTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">没有加载CSV数据或数据为空。</td></tr>'; return; } let tableHtml = ''; app.importedData.forEach(item => { const statusClass = item.status === 'submitted' ? 'status-submitted' : 'status-pending'; const statusText = item.status === 'submitted' ? '已提交' : '待提交'; tableHtml += ` <tr> <td>${item.originalIndex + 1}</td> <td>${item.city ? item.city.replace(/</g, "&lt;") : ''}</td> <td>${item.number ? item.number.replace(/</g, "&lt;") : ''}</td> <td class="${statusClass}">${statusText}</td> </tr> `; }); statusTableBody.innerHTML = tableHtml; }
    function updateHistoryPanelDisplay(renderChart = false) { logEvent(`更新历史面板显示，是否渲染图表: ${renderChart}`); if (!historyPanel) { logEvent("历史面板未创建，退出更新。", "WARN"); return; } const historyData = app._historyCache; const searchQuery = historyPanel.querySelector('#historySearchInput').value.toLowerCase(); currentFilteredHistoryForDetails = historyData.filter(entry => { if (!searchQuery) return true; return entry.phoneNumber.toLowerCase().includes(searchQuery) || (entry.city && entry.city.toLowerCase().includes(searchQuery)) || entry.date.includes(searchQuery); }); logEvent(`当前搜索词: "${searchQuery}", 过滤后得到 ${currentFilteredHistoryForDetails.length} 条记录用于统计和详细查看。`); const counts = {}; currentFilteredHistoryForDetails.forEach(entry => { counts[entry.date] = (counts[entry.date] || 0) + 1; }); const sortedCounts = Object.entries(counts).sort((a, b) => b[0].localeCompare(a[0])); const dailyCountsListEl = historyPanel.querySelector('#dailyCountsList'); const chartContainer = historyPanel.querySelector('#dailyChartCanvasContainer'); const chartCanvas = historyPanel.querySelector('#dailyChartCanvas'); const statsTitleInfoEl = historyPanel.querySelector('#statsTitleInfo'); const chartTitleEl = historyPanel.querySelector('#dailyChartTitle'); if(!dailyCountsListEl || !chartContainer || !chartCanvas || !statsTitleInfoEl || !chartTitleEl) { logEvent("updateHistoryPanelDisplay: One or more elements not found.", "ERROR"); return; } if (dailyCountsListEl.style.display !== 'none') { if (sortedCounts.length > 0) { dailyCountsListEl.innerHTML = sortedCounts.map(([date, count]) => `<li><b>${date}</b>: ${count} 条</li>`).join(''); } else { dailyCountsListEl.innerHTML = `<li>没有与 "${searchQuery || '全部'}" 相关的提交统计。</li>`; } logEvent("按日统计列表已更新。"); } if (chartContainer.style.display !== 'none' || renderChart) { if (dailyChartInstance) { dailyChartInstance.destroy(); dailyChartInstance = null; } if (sortedCounts.length > 0) { const chartLabels = sortedCounts.map(item => item[0]).reverse(); const chartDataPoints = sortedCounts.map(item => item[1]).reverse(); if (statsTitleInfoEl) statsTitleInfoEl.textContent = `(共 ${chartLabels.length} 天数据)`; if (chartTitleEl) chartTitleEl.style.display = 'block'; const ctx = chartCanvas.getContext('2d'); dailyChartInstance = new Chart(ctx, { type: 'line', data: { labels: chartLabels, datasets: [{ label: '每日提交数量', data: chartDataPoints, borderColor: 'rgb(0, 123, 255)', backgroundColor: 'rgba(0, 123, 255, 0.1)', tension: 0.1, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } }, plugins: { legend: { display: false } } } }); logEvent("折线图已更新/创建。"); } else { logEvent("无数据可用于图表。"); if (statsTitleInfoEl) statsTitleInfoEl.textContent = "(无数据)"; if (chartTitleEl) chartTitleEl.style.display = 'none'; const ctx = chartCanvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height); } } else { if (statsTitleInfoEl) statsTitleInfoEl.textContent = ""; if (chartTitleEl) chartTitleEl.style.display = 'none'; } }
    function clearHistory() { if (confirm("确定要清除所有提交历史记录吗？此操作不可恢复！")) { GM_setValue(historyStorageKey, []); app._historyCache = []; currentFilteredHistoryForDetails = []; alert("历史记录已清除。"); app.updateTodaySubmissionCount(); if (historyPanel && historyPanel.style.display !== 'none' && historyPanel.querySelector('#statsContent').classList.contains('active')) { updateHistoryPanelDisplay(historyPanel.querySelector('#showChartViewBtn')?.classList.contains('active')); } if(detailsPanel) closeDetailsPanel(); if(dailyChartInstance){dailyChartInstance.destroy(); dailyChartInstance = null;} logEvent("所有历史记录已清除。", "WARN"); } }
    function updateLogDisplay() { const logArea = historyPanel ? historyPanel.querySelector('#logDisplayArea') : null; if (logArea) { logArea.innerHTML = logEntries.slice().reverse().map(log => `<div>${log.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`).join(''); logArea.scrollTop = logArea.scrollHeight; } }
    function setActiveTab(tabId) { if (!historyPanel) return; historyPanel.querySelectorAll('.tab-controls button').forEach(btn => btn.classList.remove('active')); const activeBtn = historyPanel.querySelector(`button[data-tab="${tabId}"]`); if (activeBtn) activeBtn.classList.add('active'); historyPanel.querySelectorAll('.tab-content').forEach(content => { const isActive = content.id === tabId; content.style.display = isActive ? 'block' : 'none'; content.classList.toggle('active', isActive); }); if (tabId === 'logContent') updateLogDisplay(); else if (tabId === 'statsContent') updateHistoryPanelDisplay(historyPanel.querySelector('#showChartViewBtn')?.classList.contains('active')); else if (tabId === 'csvStatusContent') updateCsvStatusPanelDisplay(); logEvent(`切换到面板标签页: '${tabId}'`); }
    function showDetailedHistoryPanel() { logEvent("尝试打开详细记录面板。"); if (!detailsPanel) createDetailsPanel(); if (detailsPanel) { const contentDiv = detailsPanel.querySelector('.details-content'); contentDiv.innerHTML = ` <div class="date-selector-area"> <label for="detailDateInput">选择日期:</label> <input type="date" id="detailDateInput"> <button id="confirmDateBtn">确认日期</button> </div> <div id="numbersForDateList">请选择日期并确认。</div> `; detailsPanel.querySelector('#confirmDateBtn').onclick = displayNumbersForSelectedDate; detailsPanel.style.display = 'flex'; } }
    function displayNumbersForSelectedDate() { if(!detailsPanel) return; const dateInput = detailsPanel.querySelector('#detailDateInput'); const selectedDate = dateInput.value; if (!selectedDate) { alert("请选择一个日期！"); logEvent("详细记录查看：未选择日期。", "WARN"); return; } logEvent(`详细记录查看：选择的日期为 ${selectedDate}`); const numbersListDiv = detailsPanel.querySelector('#numbersForDateList'); const numbersOnDate = currentFilteredHistoryForDetails.filter(entry => entry.date === selectedDate); if (numbersOnDate.length > 0) { numbersListDiv.innerHTML = `<h5>${selectedDate} 的提交记录 (${numbersOnDate.length}条):</h5> <ul>${numbersOnDate.map(entry => `<li>${entry.phoneNumber} ${entry.city ? '(' + entry.city + ')' : ''}</li>`).join('')}</ul>`; } else { numbersListDiv.innerHTML = `<p style="padding: 10px; text-align: center;">在 ${selectedDate} 没有找到与当前搜索条件匹配的记录。</p>`; } logEvent(`显示了 ${selectedDate} 的 ${numbersOnDate.length} 条详细记录。`); }
    function createDetailsPanel() { if (document.getElementById(detailsPanelId)) return; detailsPanel = document.createElement('div'); detailsPanel.id = detailsPanelId; detailsPanel.classList.add('gm-haisuo-panel'); detailsPanel.style.display = 'none'; detailsPanel.innerHTML = ` <button class="close-button" title="关闭详细记录">&times;</button> <h5>详细提交记录</h5> <div class="details-content"> </div> `; document.body.appendChild(detailsPanel); detailsPanel.querySelector('.close-button').addEventListener('click', closeDetailsPanel); makeDraggable(detailsPanel); logEvent("详细记录面板DOM已创建。"); }
    function closeDetailsPanel() { if (detailsPanel) { detailsPanel.style.display = 'none'; logEvent("详细记录面板已关闭。");} }
    function exportHistoryToCsv() { logEvent("尝试导出历史记录为CSV。"); const historyData = app._historyCache; if (historyData.length === 0) { alert("没有历史记录可导出。"); logEvent("导出历史CSV：无数据。", "WARN"); return; } const headers = ["电话号码", "城市", "日期", "提交时间"]; let csvPayload = "\uFEFF"; csvPayload += headers.join(",") + "\n"; historyData.forEach(entry => { const timestamp = new Date(entry.timestamp); const timeString = `${('0' + timestamp.getHours()).slice(-2)}:${('0' + timestamp.getMinutes()).slice(-2)}:${('0' + timestamp.getSeconds()).slice(-2)}`; const escapeCsvField = (field) => { if (field === undefined || field === null) return ""; let strField = String(field); if (strField.includes(',') || strField.includes('\n') || strField.includes('"')) { strField = `"${strField.replace(/"/g, '""')}"`; } return strField; }; const row = [ escapeCsvField(entry.phoneNumber), escapeCsvField(entry.city), escapeCsvField(entry.date), escapeCsvField(timeString) ].join(","); csvPayload += row + "\n"; }); const dataUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvPayload); const link = document.createElement("a"); link.setAttribute("href", dataUri); link.setAttribute("download", `提交历史_${app.getFormattedDate()}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); logEvent(`历史记录已导出为CSV，共 ${historyData.length} 条。`); }
    function exportLogsToTxt() { logEvent("尝试导出运行日志为TXT。"); if (logEntries.length === 0) { alert("没有日志可导出。"); logEvent("导出日志TXT：无数据。", "WARN"); return; } let logPayload = ""; logEntries.slice().reverse().forEach(log => { logPayload += log + "\r\n"; }); const dataUri = "data:text/plain;charset=utf-8," + encodeURIComponent(logPayload); const link = document.createElement("a"); link.setAttribute("href", dataUri); link.setAttribute("download", `运行日志_${app.getFormattedDate()}_${new Date().getHours()}${new Date().getMinutes()}.txt`); document.body.appendChild(link); link.click(); document.body.removeChild(link); logEvent(`运行日志已导出为TXT，共 ${logEntries.length} 条。`); }
    function makeDraggable(elmnt) { let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0; elmnt.onmousedown = dragMouseDown; function dragMouseDown(e) { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'LABEL' || e.target.tagName === 'SELECT' || e.target.tagName === 'CANVAS' || e.target.closest('ul') || e.target.classList.contains('close-button') || e.target.closest('.tab-controls') || e.target.closest('.action-buttons') || e.target.closest('.stats-view-toggle') || e.target.closest('table') || e.target.closest('#csvStatusListContainer') ) { return; } e = e || window.event; e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY; document.onmouseup = closeDragElement; document.onmousemove = elementDrag; elmnt.style.cursor = 'grabbing'; } function elementDrag(e) { e = e || window.event; e.preventDefault(); pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY; elmnt.style.top = (elmnt.offsetTop - pos2) + "px"; elmnt.style.left = (elmnt.offsetLeft - pos1) + "px"; elmnt.style.right = 'auto'; elmnt.style.bottom = 'auto'; } function closeDragElement() { document.onmouseup = null; document.onmousemove = null; elmnt.style.cursor = 'move'; } }

    // --- 菜单命令 ---
    GM_registerMenuCommand("重置提交助手设置 (CSV增强版)", () => { GM_setValue(vueTargetCountStorageKey, 10); GM_setValue(vueRemainingCountStorageKey, 10); GM_setValue(vueIsRunningStorageKey, false); alert('提交助手主要设置已重置为默认值。缓存的CSV数据请通过面板按钮清除。请刷新页面。'); if (app) { app.targetCount = 10; app.isRunning = false; app.calculateRemainingForNewRun(); app.updateStatusText(); } logEvent("提交助手设置已通过菜单命令重置。", "WARN"); });
    GM_registerMenuCommand("清除所有提交历史记录 (CSV增强版)", () => { clearHistory(); logEvent("所有历史记录已通过菜单命令清除。", "WARN"); });
    GM_registerMenuCommand("清除所有运行日志 (CSV增强版)", () => { if (confirm("确定要清除所有运行日志吗？(不会影响已导出的文件)")) { logEntries = []; alert("运行日志已清除。"); if (historyPanel && historyPanel.querySelector('#logDisplayArea') && historyPanel.querySelector('#logDisplayArea').style.display !== 'none') { updateLogDisplay(); } logEvent("所有运行日志已通过菜单命令清除。", "WARN"); } });

    logEvent("脚本开始执行。");
})();
