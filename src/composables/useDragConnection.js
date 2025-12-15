import { computed, readonly } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import { storeToRefs } from 'pinia'

export function useDragConnection() {
    const store = useTimelineStore()

    const { connectionDragState, connectionSnapState } = storeToRefs(store)
    const isDragging = computed(() => {
        return connectionDragState.value.isDragging
    })

    function snapTo(targetId, port, pos) {
        connectionSnapState.value = {
            isActive: true,
            targetId,
            targetPort: port,
            snapPos: pos,
        }
    }

    function clearSnap() {
        connectionSnapState.value = {
            isActive: false,
            targetId: null,
            targetPort: null,
            snapPos: null
        }
    }

    function startDrag(payload) {
        connectionDragState.value = {
            isDragging: true,
            mode: payload.mode || 'create',
            sourceId: payload.sourceId,
            existingConnectionId: payload.existingConnectionId,
            startPoint: { x: payload.startX || 0, y: payload.startY || 0 },
            sourcePort: payload.sourcePort,
        }
        clearSnap()
    }

    function handleLinkDrop(fromNode, toNode, targetPort) {
        const state = connectionDragState.value

        let isConsumption = false
        if (state.existingConnectionId) {
            const connection = store.getConnectionById(state.existingConnectionId)
            if (connection) {
                isConsumption = connection.isConsumption
                store.removeConnection(state.existingConnectionId)
            }
        }

        store.createConnection(fromNode, toNode, state.sourcePort, targetPort, isConsumption)
    }

    function endDrag(targetId = null, targetPort = null) {
        if (!isDragging.value) {
            return
        }

        const state = connectionDragState.value

        let finalTargetId = targetId
        let finalPort = targetPort

        if (connectionSnapState.value.isActive && !finalTargetId) {
            finalTargetId = connectionSnapState.value.targetId
            finalPort = connectionSnapState.value.targetPort
        }

        const fromNode = store.resolveNode(state.sourceId)
        const toNode = store.resolveNode(finalTargetId)

        if (fromNode && toNode) {
            let fromActionId = fromNode.type === 'effect' ? fromNode.actionId : fromNode.id
            let toActionId = toNode.type === 'effect' ? toNode.actionId : toNode.id

            // 源节点和目标节点不一致时创建连接
            if (finalTargetId && finalTargetId !== state.sourceId && fromActionId !== toActionId) {
                handleLinkDrop(fromNode, toNode, finalPort)
            }
        }

        cancelDrag()
        clearSnap()
    }


    function newConnectionFrom(startPos, sourceId, sourcePort) {
        startDrag({
            mode: 'create',
            sourceId,
            sourcePort,
            startX: startPos.x,
            startY: startPos.y
        })
    }

    function moveConnectionEnd(connectionId, startPos) {
        const connection = store.getConnectionById(connectionId)
        if (!connection) {
            return
        }
        const nodes = store.getNodesOfConnection(connectionId)
        if (!nodes.fromNode || !nodes.toNode) {
            return
        }
        const linkDragConfig = {
            mode: 'create',
            sourceId: nodes.fromNode.id,
            existingConnectionId: connectionId,
            sourcePort: connection.sourcePort,
            startX: startPos.x,
            startY: startPos.y
        }

        startDrag(linkDragConfig)
    }

    function cancelDrag() {
        if (connectionDragState.value.existingConnectionId) {
            store.removeConnection(connectionDragState.value.existingConnectionId)
        }

        connectionDragState.value.isDragging = false;
        connectionDragState.value.sourceId = null;
    }

    return {
        isDragging,
        state: readonly(connectionDragState),
        snapState: readonly(connectionSnapState),
        snapTo,
        clearSnap,
        newConnectionFrom,
        moveConnectionEnd,
        endDrag,
        cancelDrag
    }
}
