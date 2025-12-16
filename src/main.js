import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

import App from './App.vue'

import TimelineEditor from './views/TimelineEditor.vue'
import DataEditor from './views/DataEditor.vue'

const routes = [
    { path: '/', name: 'TimelineEditor', component: TimelineEditor },
    { path: '/editor', name: 'DataEditor', component: DataEditor }
]

const router = createRouter({
    history: createWebHistory('/Endaxis/'),
    routes
})

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(ElementPlus)
app.use(router)

app.mount('#app')