import {app, ipcMain, BrowserWindow, Menu, shell} from 'electron'
import {existsSync, mkdirSync} from 'fs'
interface ApplicationOption {
    debugMode?: boolean,
    defaultAuthentication?: string
}

const applicationRun: (ApplicationOption?) => void = (function () {
    let debug: boolean
    let platform: string
    let userData: string

    let mainWindow: BrowserWindow = null

    let rendererCache: Object = {}
    
    function run(option?: ApplicationOption): void {
        debug = 'debugMode' in option ? option.debugMode : false
        platform = process.platform
        userData = app.getPath('userData')
        registerRendererEvents()
        registerAppEvents()
    }
    
    function registerAppEvents() {
        app.on('ready', applicationReady)
        app.on('activate', activeMainWindow)
        app.on('window-all-closed', () => {
            if(platform !== 'darwin') {
                app.quit()
            }
        })
    }
    function registerRendererEvents() {
        ipcMain.on('get-platform-info', (e, arg) => {
            //获得平台与设备等的基本信息。
            //return: {...}
            e.returnValue = {
                platform: platform,
                debug: debug,
                userData: userData
            }
        })
        ipcMain.on('save-cache', (e, arg) => {
            //按字典模式保存一组缓存信息。它们会按key覆盖之前的信息。
            //arg: {key: value}
            if(arg) {
                for(let key in arg) {
                    rendererCache[key] = arg[key]
                }
            }
            e.returnValue = null
        })
        ipcMain.on('load-cache', (e, arg) => {
            //从缓存加载一部分信息。
            //arg: [keys] 要加载的key的列表。此项为空则加载全部缓存。
            //return: {key: value}
            if(arg) {
                let ret = {}
                for(let key of arg) {
                    if(key in rendererCache) {
                        ret[key] = rendererCache[key]
                    }else{
                        ret[key] = undefined
                    }
                }
                e.returnValue = ret
            }else{
                e.returnValue = rendererCache
            }
        })
    }

    function applicationReady() {
        if(platform === 'darwin') {
            let devTool = debug ? {role: 'toggledevtools', label: '开发者工具'} : {role: 'forcereload', label: '完全重新加载'}
            Menu.setApplicationMenu(Menu.buildFromTemplate([
                {
                    label: 'Photos',
                    submenu: [
                        {role: 'about', label: '关于Photos'},
                        {type: 'separator'},
                        {label: '偏好设置', click() {}},
                        {type: 'separator'},
                        {role: 'hide', label: '隐藏Photos'},
                        {role: 'hideOthers', label: '隐藏其他'},
                        {role: 'unhide', label: '取消隐藏'},
                        {type: 'separator'},
                        {role: 'quit', label: '退出Photos'},
                    ]
                },
                {
                    label: '编辑',
                    role: 'editMenu',
                    submenu: [
                        {role: 'undo', label: '撤销'},
                        {role: 'redo', label: '重做'},
                        {type: 'separator'},
                        {role: 'cut', label: '剪切'},
                        {role: 'copy', label: '复制'},
                        {role: 'paste', label: '粘贴'},
                        {type: 'separator'},
                        {role: 'delete', label: '删除'},
                        {role: 'selectall', label: '全选'}
                    ]
                },
                {
                    label: '显示',
                    submenu: [
                        {role: 'reload', label: '重新加载'},
                        devTool,
                        {type: 'separator'},
                        {role: 'togglefullscreen', label: '全屏'}
                    ]
                },
                {
                    label: '窗口',
                    role: 'windowMenu',
                    submenu: [
                        {role: 'minimize', label: '最小化'},
                        {role: 'close', label: '关闭窗口'}
                    ]
                },
                {
                    label: '帮助',
                    role: 'help',
                    submenu: [
                        {
                            label: '关于本项目',
                            click() {
                                shell.openExternal('https://github.com/HeerKirov/photos')
                            }
                        }
                    ]
                }
            ]))
        }
        if(!existsSync(userData)) {
            try {
                mkdirSync(userData)
            }catch (e) {
                //resume
            }
        }
        activeMainWindow()
    }

    function activeMainWindow(): void {
        if(mainWindow == null) {
            let win: BrowserWindow = new BrowserWindow({
                minWidth: 640, minHeight: 480,
                width: 960, height: 640,
                titleBarStyle: "hidden",
                title: "Photos"
            })
            if(platform !== 'darwin') {
                win.setMenuBarVisibility(false)
            }
            win.on('closed', () => {
                mainWindow = null
            })

            mainWindow = win
            win.loadFile('view/view.html')
            if(debug) {
                mainWindow.webContents.openDevTools()
            }
        }else if(!mainWindow.isVisible()) {
            mainWindow.show()
        }
    }

    return run
})()

export {applicationRun}