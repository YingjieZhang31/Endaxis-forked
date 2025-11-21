import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// 工具：生成简易 UUID
const uid = () => Math.random().toString(36).substring(2, 9)

export const useTimelineStore = defineStore('timeline', () => {

    // ===================================================================================
    // 1. 常量定义 (Constants & Config)
    // ===================================================================================

    const SP_MAX = 300
    const SP_REGEN_RATE = 8
    const BASE_BLOCK_WIDTH = 50
    const TOTAL_DURATION = 120

    // 元素属性颜色映射表 (全局标准色)
    const ELEMENT_COLORS = {
        // --- 基础元素 ---
        "blaze": "#ff4d4f",    // 灼热 (红)
        "cold": "#00e5ff",     // 寒冷 (青)
        "emag": "#ffd700",     // 电磁 (金黄)
        "nature": "#52c41a",   // 自然 (绿)
        "physical": "#e0e0e0", // 物理 (银灰)

        // --- 动作类型 ---
        "link": "#fdd900",     // 连携 (金)
        "execution": "#a61d24",// 处决 (红灰)
        "skill": "#ffffff",    // 战技 (白)
        "ultimate": "#00e5ff", // 终结技 (青)
        "attack": "#aaaaaa",   // 重击 (灰)
        "default": "#8c8c8c",  // 未知

        // --- 详细状态 (映射到基础色) ---
        'blaze_attach': '#ff4d4f', 'blaze_burst': '#ff7875', 'burning': '#f5222d',
        'cold_attach': '#00e5ff', 'cold_burst': '#40a9ff', 'frozen': '#1890ff', 'ice_shatter': '#bae7ff',
        'emag_attach': '#ffd700', 'emag_burst': '#fff566', 'conductive': '#ffec3d',
        'nature_attach': '#95de64', 'nature_burst': '#73d13d', 'corrosion': '#52c41a',
        'break': '#ffffff', 'armor_break': '#f0f0f0', 'stagger': '#e6e6e6',
        'knockdown': '#d9d9d9', 'knockup': '#ffffff',
    }

    /**
     * 获取颜色工具函数 (对外暴露)
     */
    const getColor = (key) => {
        return ELEMENT_COLORS[key] || ELEMENT_COLORS.default
    }

    // ===================================================================================
    // 2. 基础状态 (State)
    // ===================================================================================

    const characterRoster = ref([])  // 干员数据库
    const isLoading = ref(true)
    const iconDatabase = ref({})

    // 四条轨道数据结构
    const tracks = ref([
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
        { id: null, actions: [], initialGauge: 0, maxGaugeOverride: null },
    ])

    const connections = ref([])      // 连线数据

    // === 交互状态 (UI State) ===
    const activeTrackId = ref(null)          // 当前选中的轨道 (用于左侧技能库显示)
    const timelineScrollLeft = ref(0)        // 水平滚动位置 (用于同步 SP 监控)
    const zoomLevel = ref(1.0)               // 全局缩放等级
    const globalDragOffset = ref(0)          // 拖拽时的偏移量修正
    const draggingSkillData = ref(null)      // 当前正在从库中拖拽的数据
    const selectedActionId = ref(null)       // 当前选中的动作实例 ID
    const selectedLibrarySkillId = ref(null) // 当前选中的库技能 ID
    const characterOverrides = ref({})       // 针对具体技能的全局数值覆盖 (Save/Load 用)

    // 连线状态机
    const isLinking = ref(false)
    const linkingSourceId = ref(null)
    const linkingEffectIndex = ref(null)

    // ===================================================================================
    // 3. 计算属性 (Getters)
    // ===================================================================================

    /**
     * 快速查找动作所在的轨道索引及引用
     */
    const getActionPositionInfo = (instanceId) => {
        for (let i = 0; i < tracks.value.length; i++) {
            const track = tracks.value[i];
            const action = track.actions.find(a => a.instanceId === instanceId);
            if (action) return { trackIndex: i, action };
        }
        return null;
    };

    /**
     * 获取指向目标 Action 的所有连线
     */
    const getIncomingConnections = (targetId) => {
        return connections.value.filter(c => c.to === targetId);
    };

    /**
     * 获取指定干员的元素属性颜色
     */
    const getCharacterElementColor = (characterId) => {
        const charInfo = characterRoster.value.find(c => c.id === characterId)
        if (!charInfo || !charInfo.element) return ELEMENT_COLORS.default
        return ELEMENT_COLORS[charInfo.element] || ELEMENT_COLORS.default
    }

    const timeBlockWidth = computed(() => BASE_BLOCK_WIDTH * zoomLevel.value)

    /**
     * [核心逻辑] 生成当前选中干员的技能库列表
     * 负责将 JSON 数据转换为标准化的技能对象，并注入属性颜色
     */
    const activeSkillLibrary = computed(() => {
        const activeChar = characterRoster.value.find(c => c.id === activeTrackId.value)
        if (!activeChar) return []

        const getAnomalies = (list) => list || []
        const getAllowed = (list) => list || []

        const createBaseSkill = (suffix, type, name) => {
            const globalId = `${activeChar.id}_${suffix}`
            const globalOverride = characterOverrides.value[globalId] || {}

            const rawDuration = activeChar[`${suffix}_duration`] || 1
            const rawCooldown = activeChar[`${suffix}_cooldown`] || 0

            // === 属性继承逻辑 ===
            let derivedElement = activeChar.element || 'physical';

            // 1. 优先读取技能独立配置
            if (activeChar[`${suffix}_element`]) {
                derivedElement = activeChar[`${suffix}_element`];
            }
            // 2. 特殊类型强制规则
            if (suffix === 'attack') derivedElement = 'physical';
            if (suffix === 'execution') derivedElement = 'physical';
            if (suffix === 'link') derivedElement = null;

            // === 数值读取 ===
            let defaults = { spCost: 0, spGain: 0, gaugeCost: 0, gaugeGain: 0 }

            if (suffix === 'attack') {
                defaults.spGain = activeChar.attack_spGain || 0
            } else if (suffix === 'skill') {
                defaults.spCost = activeChar.skill_spCost || 100;
                defaults.spGain = activeChar.skill_spReply || 0;
                defaults.gaugeGain = activeChar.skill_gaugeGain || 0
            } else if (suffix === 'link') {
                defaults.spGain = activeChar.link_spGain || 0;
                defaults.gaugeGain = activeChar.link_gaugeGain || 0
            } else if (suffix === 'ultimate') {
                defaults.gaugeCost = activeChar.ultimate_gaugeMax || 1000;
                defaults.spGain = activeChar.ultimate_spReply || 0;
                defaults.gaugeGain = activeChar.ultimate_gaugeReply || 0
            } else if (suffix === 'execution') {
                defaults.spGain = activeChar.execution_spGain || 0;
            }

            const merged = {
                duration: rawDuration,
                cooldown: rawCooldown,
                ...defaults,
                ...globalOverride
            }

            return {
                id: globalId,
                type: type,
                name: name,
                element: derivedElement,
                duration: merged.duration,
                cooldown: merged.cooldown,
                spCost: merged.spCost,
                spGain: merged.spGain,
                gaugeCost: merged.gaugeCost,
                gaugeGain: merged.gaugeGain,
                allowedTypes: getAllowed(activeChar[`${suffix}_allowed_types`]),
                physicalAnomaly: getAnomalies(activeChar[`${suffix}_anomalies`])
            }
        }

        return [
            createBaseSkill('attack', 'attack', '重击'),
            createBaseSkill('execution', 'execution', '处决'),
            createBaseSkill('skill', 'skill', '战技'),
            createBaseSkill('link', 'link', '连携'),
            createBaseSkill('ultimate', 'ultimate', '终结技')
        ]
    })

    /**
     * 获取当前队伍的轨道信息 (绑定了干员详情)
     */
    const teamTracksInfo = computed(() => tracks.value.map(track => {
        const charInfo = characterRoster.value.find(c => c.id === track.id)
        return { ...track, ...(charInfo || { name: '未知', avatar: '', rarity: 0 }) }
    }))

    // ===================================================================================
    // 4. 业务逻辑 (Actions)
    // ===================================================================================

    function setZoom(val) {
        if (val < 0.2) val = 0.2; if (val > 3.0) val = 3.0; zoomLevel.value = val
    }
    function setDraggingSkill(skill) { draggingSkillData.value = skill }
    function setDragOffset(offset) { globalDragOffset.value = offset }
    function setScrollLeft(val) { timelineScrollLeft.value = val }

    /**
     * 计算全局 SP 曲线 (离散事件模拟)
     */
    function calculateGlobalSpData() {
        const events = []
        // 1. 收集所有 SP 变动事件
        tracks.value.forEach(track => {
            if (!track.actions) return
            track.actions.forEach(action => {
                if (action.spCost > 0) events.push({ time: action.startTime, change: -action.spCost, type: 'cost' })
                if (action.spGain > 0) events.push({ time: action.startTime + action.duration, change: action.spGain, type: 'gain' })
            })
        })
        events.sort((a, b) => a.time - b.time)

        // 2. 模拟时间推进
        const points = []; let currentSp = 200; let currentTime = 0;
        points.push({ time: 0, sp: currentSp });

        const advanceTime = (targetTime) => {
            const timeDiff = targetTime - currentTime; if (timeDiff <= 0) return;

            // 如果已经满 SP，直接推进时间
            if (currentSp >= SP_MAX) {
                currentTime = targetTime; points.push({ time: currentTime, sp: SP_MAX }); return;
            }

            const potentialGain = timeDiff * SP_REGEN_RATE;
            const projectedSp = currentSp + potentialGain;

            // 如果中间会溢出，记录溢出时刻点
            if (projectedSp >= SP_MAX) {
                const timeToMax = (SP_MAX - currentSp) / SP_REGEN_RATE;
                points.push({ time: currentTime + timeToMax, sp: SP_MAX });
                currentSp = SP_MAX; currentTime = targetTime;
                points.push({ time: currentTime, sp: SP_MAX });
            } else {
                currentSp = projectedSp; currentTime = targetTime;
                points.push({ time: currentTime, sp: currentSp });
            }
        }

        events.forEach(ev => {
            advanceTime(ev.time);
            currentSp += ev.change;
            // SP 溢出截断
            if (currentSp > SP_MAX) currentSp = SP_MAX;
            points.push({ time: currentTime, sp: currentSp, type: ev.type })
        });

        if (currentTime < TOTAL_DURATION) advanceTime(TOTAL_DURATION);
        return points
    }

    /**
     * 计算单个轨道的充能曲线 (Gauge)
     */
    function calculateGaugeData(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return []
        const charInfo = characterRoster.value.find(c => c.id === trackId)
        if (!charInfo) return []

        const libId = `${trackId}_ultimate`
        const override = characterOverrides.value[libId]
        const GAUGE_MAX = (track.maxGaugeOverride && track.maxGaugeOverride > 0) ? track.maxGaugeOverride : ((override && override.gaugeCost) ? override.gaugeCost : (charInfo.ultimate_gaugeMax || 100))

        const events = []
        track.actions.forEach(action => {
            if (action.gaugeCost > 0) events.push({ time: action.startTime, change: -action.gaugeCost })
            if (action.gaugeGain > 0) events.push({ time: action.startTime + action.duration, change: action.gaugeGain })
        })
        events.sort((a, b) => a.time - b.time)

        const initialGauge = track.initialGauge || 0
        let currentGauge = initialGauge > GAUGE_MAX ? GAUGE_MAX : initialGauge
        const points = [];
        points.push({ time: 0, val: currentGauge, ratio: currentGauge / GAUGE_MAX });

        events.forEach(ev => {
            points.push({ time: ev.time, val: currentGauge, ratio: currentGauge / GAUGE_MAX })
            currentGauge += ev.change;
            if (currentGauge > GAUGE_MAX) currentGauge = GAUGE_MAX;
            if (currentGauge < 0) currentGauge = 0
            points.push({ time: ev.time, val: currentGauge, ratio: currentGauge / GAUGE_MAX })
        })
        points.push({ time: TOTAL_DURATION, val: currentGauge, ratio: currentGauge / GAUGE_MAX })
        return points
    }

    // === 数据持久化与交互 ===
    function updateTrackMaxGauge(trackId, value) { const track = tracks.value.find(t => t.id === trackId); if (track) track.maxGaugeOverride = value }
    function updateTrackInitialGauge(trackId, value) { const track = tracks.value.find(t => t.id === trackId); if (track) track.initialGauge = value }

    function updateLibrarySkill(skillId, props) {
        if (!characterOverrides.value[skillId]) characterOverrides.value[skillId] = {}
        Object.assign(characterOverrides.value[skillId], props)
        // 同步更新已放置的同类技能
        tracks.value.forEach(track => { if (!track.actions) return; track.actions.forEach(action => { if (action.id === skillId) { Object.assign(action, props) } }) })
    }

    const cloneSkill = (skill) => {
        const clonedAnomalies = skill.physicalAnomaly ? JSON.parse(JSON.stringify(skill.physicalAnomaly)) : [];
        return { ...skill, instanceId: `inst_${uid()}`, physicalAnomaly: clonedAnomalies }
    }

    function addSkillToTrack(trackId, skill, startTime) {
        const track = tracks.value.find(t => t.id === trackId); if (!track) return
        const newAction = cloneSkill(skill); newAction.startTime = startTime
        track.actions.push(newAction); track.actions.sort((a, b) => a.startTime - b.startTime)
    }

    function selectLibrarySkill(skillId) { selectedActionId.value = null; selectedLibrarySkillId.value = (selectedLibrarySkillId.value === skillId) ? null : skillId }
    function selectAction(instanceId) { selectedLibrarySkillId.value = null; selectedActionId.value = (instanceId === selectedActionId.value) ? null : instanceId }
    function updateAction(instanceId, newProperties) {
        for (const track of tracks.value) { const action = track.actions.find(a => a.instanceId === instanceId); if (action) { Object.assign(action, newProperties); return; } }
    }
    function removeAction(instanceId) {
        if (!instanceId) return
        for (const track of tracks.value) { const index = track.actions.findIndex(a => a.instanceId === instanceId); if (index !== -1) { track.actions.splice(index, 1); break; } }
        connections.value = connections.value.filter(c => c.from !== instanceId && c.to !== instanceId)
        if (selectedActionId.value === instanceId) selectedActionId.value = null
    }

    function selectTrack(trackId) { activeTrackId.value = trackId; selectedActionId.value = null; selectedLibrarySkillId.value = null; cancelLinking() }
    function changeTrackOperator(trackIndex, oldOperatorId, newOperatorId) {
        const track = tracks.value[trackIndex];
        if (track) {
            if (tracks.value.some((t, i) => i !== trackIndex && t.id === newOperatorId)) { alert('该干员已在另一条轨道上！'); return; }
            track.id = newOperatorId; track.actions = [];
            if (activeTrackId.value === oldOperatorId) activeTrackId.value = newOperatorId;
        }
    }

    // === 外部 IO ===
    async function fetchGameData() {
        try {
            isLoading.value = true
            const response = await fetch('/gamedata.json')
            if (!response.ok) throw new Error('无法加载 gamedata.json')
            const data = await response.json()
            const sortedRoster = data.characterRoster.sort((a, b) => (b.rarity || 0) - (a.rarity || 0));
            characterRoster.value = sortedRoster
            iconDatabase.value = data.ICON_DATABASE
        } catch (error) { console.error("加载数据失败:", error) } finally { isLoading.value = false }
    }

    function exportProject() {
        const projectData = { version: '2.0.0', timestamp: Date.now(), tracks: tracks.value, connections: connections.value, characterOverrides: characterOverrides.value }
        const jsonString = JSON.stringify(projectData, null, 2); const blob = new Blob([jsonString], { type: 'application/json' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `endaxis_project_${new Date().toISOString().slice(0, 10)}.json`;
        link.click(); URL.revokeObjectURL(link.href)
    }

    async function importProject(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result); if (!data.tracks) throw new Error("无效的项目文件");
                    tracks.value = data.tracks; connections.value = data.connections || []; characterOverrides.value = data.characterOverrides || {};
                    selectedActionId.value = null; selectedLibrarySkillId.value = null; resolve(true)
                } catch (err) { reject(err) }
            }; reader.readAsText(file)
        })
    }

    // === 连线逻辑 ===
    function startLinking(effectIndex = null) {
        if (!selectedActionId.value) return;
        if (isLinking.value && linkingSourceId.value === selectedActionId.value && linkingEffectIndex.value === effectIndex) { cancelLinking(); return; }
        isLinking.value = true; linkingSourceId.value = selectedActionId.value; linkingEffectIndex.value = effectIndex;
    }

    function confirmLinking(targetId, targetEffectIndex = null) {
        if (!isLinking.value || !linkingSourceId.value) return cancelLinking();
        if (linkingSourceId.value === targetId) { cancelLinking(); return; }
        const exists = connections.value.some(c => c.from === linkingSourceId.value && c.to === targetId && c.fromEffectIndex === linkingEffectIndex.value && c.toEffectIndex === targetEffectIndex)
        if (!exists) { connections.value.push({ id: `conn_${uid()}`, from: linkingSourceId.value, to: targetId, fromEffectIndex: linkingEffectIndex.value, toEffectIndex: targetEffectIndex }) }
        cancelLinking()
    }

    function cancelLinking() { isLinking.value = false; linkingSourceId.value = null; linkingEffectIndex.value = null; }
    function removeConnection(connId) { connections.value = connections.value.filter(c => c.id !== connId) }

    return {
        // State
        isLoading, characterRoster, iconDatabase, tracks, connections,
        activeTrackId, timelineScrollLeft, zoomLevel,
        globalDragOffset, draggingSkillData,
        selectedActionId, selectedLibrarySkillId,
        isLinking, linkingSourceId, linkingEffectIndex,
        // Getters
        teamTracksInfo, activeSkillLibrary, timeBlockWidth, ELEMENT_COLORS,
        // Actions
        fetchGameData, exportProject, importProject, TOTAL_DURATION,
        selectTrack, changeTrackOperator,
        selectLibrarySkill, updateLibrarySkill,
        selectAction, updateAction, removeAction,
        cloneSkill, addSkillToTrack,
        setDraggingSkill, setDragOffset, setScrollLeft, setZoom,
        calculateGlobalSpData, calculateGaugeData,
        updateTrackInitialGauge, updateTrackMaxGauge,
        startLinking, confirmLinking, cancelLinking, removeConnection,
        getColor,
        getActionPositionInfo, getIncomingConnections, getCharacterElementColor
    }
})