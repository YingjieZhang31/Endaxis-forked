import { createRouter, createWebHistory } from 'vue-router'

const routes = [
    { path: '/', name: 'TimelineEditor', component: () => import('../views/TimelineEditor.vue') },
    { path: '/editor', name: 'DataEditor', component: () => import('../views/DataEditor.vue') }
]

const router = createRouter({
    history: createWebHistory('/Endaxis/'),
    routes
})

export default router