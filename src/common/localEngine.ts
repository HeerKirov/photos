import {
    DataEngine,
    ImageSpecification,
    ImageFindOption,
    TagFindOption,
    Image,
    caseImage,
    sortImage,
    caseTag
} from './engine'
import { Formula, decrypt } from './appStorage'
import { BufferCache } from './bufferCache'
import { writeFileSync, readFileSync, existsSync, open, read, write, openSync, readSync, writeSync, close, closeSync } from 'fs'
import { encrypt } from './utils'
import { NativeImage } from 'electron'
import { translateNativeImage } from './imageTool'

const STORAGE = 'data.db'

const BLOCK_SIZE = 1024 * 64 //64KB
const BLOCK_IN_FILE = 1024 //1024 blocks(64MB) in max case
function FILE_NAME(index: number): string {
    return `block-${(index + 0xa000).toString(16)}.dat`
}

class LocalDataEngine implements DataEngine {
    constructor(private storageFolder: string, private key: string) { }
    findImage(options?: ImageFindOption): Image[] {
        if(options) {
            let ret = []
            for(let image of this.imageMemory) {
                if(caseImage(image, options)) {
                    ret[ret.length] = image
                }
            }
            if(options.order) {
                sortImage(ret, options.order, options.desc !== undefined ? options.desc : true)
            }else if(options.desc !== undefined && options.desc === false) {
                ret.reverse()
            }
            return ret
        }else{
            return this.imageMemory
        }
    }
    createImage(images: Image[]): Image[] {
        let maxIndex = 0
        for(let image of images) {
            if(image.id > maxIndex) {
                maxIndex = image.id
            }
            this.imageMemory[this.imageMemory.length] = image
            for(let tag of image.tags) {
                if(!(tag in this.tagMemory)) {
                    this.tagMemory[this.tagMemory.length] = tag
                }
            }
            if(image.buffer !== undefined) {
                let blocks = saveImageBuffer(this.storageFolder, image.buffer, this.blockMaxMemory)
                for(let b of blocks) {
                    if(b > this.blockMaxMemory) {
                        this.blockMaxMemory = b
                    }
                }
                this.blockMemory[image.id] = {
                    size: image.buffer.byteLength,
                    blocks: blocks
                }
            }
        }
        if(maxIndex > this.indexMemory) {
            this.indexMemory = maxIndex + 1
        }
        return images
    }
    updateImage(images: Image[]): Image[] {
        let success = []
        for(let image of images) {
            for(let idx in this.imageMemory) {
                if(this.imageMemory[idx].id === image.id) {
                    for(let tag of image.tags) {
                        if((!(tag in this.imageMemory[idx].tags))&&(!(tag in this.tagMemory))) {
                            this.tagMemory[this.tagMemory.length] = tag
                        }
                    }
                    //TODO 追加对image的更改
                    this.imageMemory[idx] = image
                    success[success.length] = image
                    break
                }
            }
        }
        return success
    }
    deleteImage(images: (number | Image)[]): number {
        let ret = 0
        for(let i of images) {
            let idx = typeof i === "number" ? i : i.id
            for(let i = 0; i < this.imageMemory.length; ++i) {
                if(this.imageMemory[i].id === idx) {
                    this.imageMemory.splice(i, 1)
                    ret ++
                    this.imageDataCache.remove(idx)
                    this.imageBufferCache.remove(idx)
                    this.blockMemory[idx] = undefined
                    //目前的删除方案：从缓存区删除缓存；从分区表中删除分区，但是不删除实体文件中的内容
                    //可以做的改进：整理分区表，重新利用被删除的分区以覆盖和复用。
                    break
                }
            }
        }
        return ret
    }
    loadImageURL(id: number, specification?: ImageSpecification, callback?: (string) => void): string {
        if(callback !== undefined) {
            let spec = specification ? specification : ImageSpecification.Origin
            let cache = this.imageDataCache.get(spec, id)
            if(cache != null) {
                callback(cache)
                return undefined
            }
            let originBuf = this.imageBufferCache.get(ImageSpecification.Origin, id)
            if(originBuf != null) {
                let native = NativeImage.createFromBuffer(originBuf)
                let goalNative = translateNativeImage(native, spec)
                let dataUrl = goalNative.toDataURL()
                this.imageDataCache.set(spec, id, dataUrl)
                callback(dataUrl)
                return undefined
            }
            let {blocks, size} = this.blockMemory[id]
            if(!blocks) {
                callback(null)
                return undefined
            }
            loadImageBuffer(this.storageFolder, blocks, size, (buffer) => {
                if(buffer != null) {
                    let native = NativeImage.createFromBuffer(buffer)
                    let goalNative = translateNativeImage(native, spec)
                    let dataUrl = goalNative.toDataURL()
                    this.imageDataCache.set(spec, id, dataUrl)
                    this.imageBufferCache.set(ImageSpecification.Origin, id, buffer)
                    callback(dataUrl)
                }else{
                    callback(null)
                }
            })
        }else{
            let spec = specification ? specification : ImageSpecification.Origin
            let cache = this.imageDataCache.get(spec, id)
            if(cache != null) {
                return cache
            }
            let originBuf = this.imageBufferCache.get(ImageSpecification.Origin, id)
            if(originBuf != null) {
                let native = NativeImage.createFromBuffer(originBuf)
                let goalNative = translateNativeImage(native, spec)
                let dataUrl = goalNative.toDataURL()
                this.imageDataCache.set(spec, id, dataUrl)
                return dataUrl
            }
            let {blocks, size} = this.blockMemory[id]
            if(!blocks) {
                return null
            }
            let buffer = loadImageBuffer(this.storageFolder, blocks, size)
            if(buffer != null) {
                let native = NativeImage.createFromBuffer(buffer)
                let goalNative = translateNativeImage(native, spec)
                let dataUrl = goalNative.toDataURL()
                this.imageDataCache.set(spec, id, dataUrl)
                this.imageBufferCache.set(ImageSpecification.Origin, id, buffer)
                return dataUrl
            }
            return null
        }
    }
    findTag(options?: TagFindOption): string[] {
        if(options) {
            let ret = []
            for(let tag of this.tagMemory) {
                if(caseTag(tag, options)) {
                    ret[ret.length] = tag
                }
            }
            if(options.order) {
                sortImage(ret, options.order, options.desc !== undefined ? options.desc : false)
            }else if(options.desc !== undefined && options.desc === false) {
                ret.reverse()
            }
            return ret
        }else{
            return this.tagMemory
        }
    }
    getNextId(): number {
        return this.indexMemory
    }

    connect(): boolean {
        return this.load()
    }
    close(): void {
        this.save()
    }

    load(): boolean {
        if(existsSync(`${this.storageFolder}/${STORAGE}`)) {
            let buf = readFileSync(`${this.storageFolder}/${STORAGE}`)
            let data = decrypt(this.key, buf)
            if(data != null) {
                this.imageMemory = data['images']
                this.indexMemory = data['index']
                this.blockMemory = data['blocks']
                this.blockMaxMemory = data['blockMax']
                this.tagMemory = []
                for(let image of this.imageMemory) {
                    for(let tag of image.tags) {
                        if(!(tag in this.tagMemory)) {
                            this.tagMemory[this.tagMemory.length] = tag
                        }
                    }
                }
                return true
            }
            return false
        }else{
            this.indexMemory = 1
            this.imageMemory = []
            this.tagMemory = []
            this.blockMemory = {}
            this.blockMaxMemory = -1
            return true
        }
    }
    save() {
        let buf = encrypt(this.key, {
            index: this.indexMemory,
            images: this.imageMemory,
            blocks: this.blockMemory,
            blockMax: this.blockMaxMemory
        })
        writeFileSync(`${this.storageFolder}/${STORAGE}`, buf)
    }

    private indexMemory: number = null
    private imageMemory: Image[] = []
    private tagMemory: string[] = []
    private blockMemory: {} = {} //number(imageId) -> {blocks: number[], size: number} (blocks index array)的缓存映射
    private blockMaxMemory: number = -1 //当前正在使用的block的最大序号。因为block从0开始因此该序号最小值为-1
    private imageDataCache: BufferCache<string> = new BufferCache()
    private imageBufferCache: BufferCache<Buffer> = new BufferCache()
}

class LocalFormula implements Formula {
    constructor(id?: string, key?: string, storage?: string) {
        this.type = 'local'
        if(id) this.id = id
        if(key) this.key = key
        if(storage) this.storage = storage
    }
    type: string
    id: string
    key: string
    storage: string
    buildEngine(): DataEngine {
        try {
            return new LocalDataEngine(this.storage, this.key)
        }catch(e) {
            return null
        }
    }
}

function loadImageBuffer(folder: string, blocks: number[], size: number, callback?: (Buffer) => void): Buffer {
    let map = {}
    for(let i = 0; i < blocks.length; ++i) {
        let block = blocks[i]
        let filename = `${folder}/${FILE_NAME(Math.floor(block / BLOCK_IN_FILE))}`
        if(filename in map) {
            let arr = map[filename]
            arr[arr.length] = {id: i, block: block % BLOCK_IN_FILE, size: (i === blocks.length - 1) ? size % BLOCK_SIZE : BLOCK_SIZE}
        }else{
            map[filename] = [{id: i, block: block % BLOCK_IN_FILE, size: (i === blocks.length - 1) ? size % BLOCK_SIZE : BLOCK_SIZE}]
        }
    }
    if(callback !== undefined) {
        let buf = Buffer.alloc(size)
        for(let filename in map) {
            let blocks = map[filename]
            let flag = blocks.length
            open(filename, 'r', (err, fd) => {
                for(let {id, block, size} of blocks) {
                    read(fd, buf, id * BLOCK_SIZE, size, block * BLOCK_SIZE, (err, read, buffer) => {
                        flag -= 1
                        if(flag <= 0) {
                            callback(buf)
                        }
                    })
                }
                close(fd, () => {})
            })
        }
    }else{
        let buf = Buffer.alloc(size)
        for(let filename in map) {
            let blocks = map[filename]
            let fd = openSync(filename, 'r')
            for(let {id, block, size} of blocks) {
                readSync(fd, buf, id * BLOCK_SIZE, size, block * BLOCK_SIZE)
            }
            closeSync(fd)
        }
        return buf
    }
}

function saveImageBuffer(folder: string, buffer: Buffer, blockMaxIndex: number, callback?: (Array) => void): number[] {
    let blockNum = Math.floor(buffer.byteLength / BLOCK_SIZE) + 1
    let blocks = []
    for(let i = 0; i < blockNum; ++i) {
        blocks[i] = blockMaxIndex + i + 1
    }
    let map = {}
    for(let i = 0; i < blocks.length; ++i) {
        let block = blocks[i]
        let filename = `${folder}/${FILE_NAME(Math.floor(block / BLOCK_IN_FILE))}`
        if(filename in map) {
            let arr = map[filename]
            arr[arr.length] = {id: i, block: block % BLOCK_IN_FILE, size: (i === blocks.length - 1) ? buffer.byteLength % BLOCK_SIZE : BLOCK_SIZE}
        }else{
            map[filename] = [{id: i, block: block % BLOCK_IN_FILE, size: (i === blocks.length - 1) ? buffer.byteLength % BLOCK_SIZE : BLOCK_SIZE}]
        }
    }

    if(callback !== undefined) {
        for(let filename in map) {
            let mapBlock = map[filename]
            let flag = mapBlock.length
            open(filename, 'w+', (err, fd) => {
                for(let {id, block, size} of mapBlock) {
                    write(fd, buffer, id * BLOCK_SIZE, size, block * BLOCK_SIZE, (err, read, buf) => {
                        flag -= 1
                        if(flag <= 0) {
                            callback(blocks)
                        }
                    })
                }
                close(fd, () => {})
            })
        }
    }else{
        for(let filename in map) {
            let blocks = map[filename]
            let fd = openSync(filename, 'w+')
            for(let {id, block, size} of blocks) {
                writeSync(fd, buffer, id * BLOCK_SIZE, size, block * BLOCK_SIZE)
            }
            closeSync(fd)
        }
        return blocks
    }
}

export {LocalDataEngine, LocalFormula}