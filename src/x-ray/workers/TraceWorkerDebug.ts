import {Camera} from "../core/src/engine/scene/Camera";
import {Scene} from "../core/src/engine/scene/Scene";
import {RGBA} from "../core/src/engine/math/Color";
import {Color} from "../core/src/engine/math/Color";
import {Ray} from "../core/src/engine/math/Ray";
import {Cube} from "../core/src/engine/scene/shapes/Cube";
import {Vector3} from "../core/src/engine/math/Vector3";
import {DiffuseMaterial} from "../core/src/engine/scene/materials/DiffuseMaterial";
import {Sphere} from "../core/src/engine/scene/shapes/Sphere";
import {LightMaterial} from "../core/src/engine/scene/materials/LightMaterial";
import {LinearAttenuation} from "../core/src/engine/scene/materials/Attenuation";
import {SpecularMaterial} from "../core/src/engine/scene/materials/SpecularMaterial";
import {SharedScene} from "../core/src/engine/scene/SharedScene";
import {DirectMemory} from "../core/src/pointer/src/DirectMemory";
import {TraceJob} from "../core/src/engine/renderer/worker/TraceJob";
import {ThreadPool} from "../core/src/engine/renderer/worker/ThreadPool";

/**
 * Created by Nidin Vinayakan on 10-01-2016.
 */
export class TraceWorkerDebug {

    id:number;
    flags:Uint8Array;
    pixelMemory:Uint8ClampedArray;
    sampleMemory:Float32Array;
    camera;
    scene;
    sampler;
    full_width:number;
    full_height:number;
    width:number;
    height:number;
    xoffset:number;
    yoffset:number;
    samples:Color[];
    cameraSamples:number;
    absCameraSamples:number;
    hitSamples:number;
    bounces:number;
    iterations:number = 1;
    private locked:boolean;

    constructor() {
        addEventListener('message', this.onMessageReceived.bind(this), false);
    }

    onMessageReceived(e:any) {

        var data = e.data;

        switch (data.command) {

            case TraceJob.INIT:

                this.id = e.data.id;
                this.flags = new Uint8Array(e.data.flagsBuffer);
                this.pixelMemory = new Uint8ClampedArray(e.data.pixelBuffer);
                this.sampleMemory = new Float32Array(e.data.sampleBuffer);

                let RAW_MEMORY = e.data.turboBuffer;
                turbo.Runtime.init(RAW_MEMORY, 0, RAW_MEMORY.byteLength, false);
                importScripts('../../../libs/xray-kernel/xray-kernel-turbo.js');
                unsafe.RAW_MEMORY = RAW_MEMORY;

                if (!this.camera) {
                    this.camera = e.data.camera;
                }

                if (!this.scene) {
                    this.scene = e.data.scene;
                }

                this.full_width = e.data.full_width;
                this.full_height = e.data.full_height;
                this.cameraSamples = e.data.cameraSamples;
                this.hitSamples = e.data.hitSamples;
                this.bounces = e.data.bounces;

                this.sampler = xray.NewSampler(1, 5);
                // this.sampler = xray.NewSampler(16, 8);
                // this.sampler = xray.NewDirectSampler();

                postMessage(TraceJob.INITED);

                break;

            case TraceJob.TRACE:

                if (this.flags[3 + this.id] === 2) {//thread locked
                    console.log("exit:1");
                    this.lock();
                    return;
                }

                this.init(
                    e.data.width,
                    e.data.height,
                    e.data.xoffset,
                    e.data.yoffset
                );

                this.cameraSamples = e.data.cameraSamples || this.cameraSamples;
                this.hitSamples = e.data.hitSamples || this.hitSamples;

                if (e.data.camera) {
                    // this.camera.updateFromJson(e.data.camera);
                    //console.log(e.data.camera);
                }

                this.iterations = e.data.init_iterations || 0;

                if (this.locked) {
                    console.log("restarted:" + this.iterations, "samples:" + this.checkSamples());
                    this.locked = false;
                }

                if (this.iterations > 0 && e.data.blockIterations) {
                    for (var i = 0; i < e.data.blockIterations; i++) {
                        if (this.flags[3 + this.id] === 2) {//thread locked
                            this.lock();
                            return;
                        }
                        this.run();
                    }
                } else {
                    if (this.flags[3 + this.id] === 2) {//thread locked
                        this.lock();
                        return;
                    }
                    this.run();
                }
                if (this.flags[3 + this.id] === 2) {//thread locked
                    this.lock();
                    return;
                }
                postMessage(TraceJob.TRACED);
                break;
        }

    }

    init(width:number, height:number, xoffset:number, yoffset:number):void {
        this.width = width;
        this.height = height;
        this.xoffset = xoffset;
        this.yoffset = yoffset;
        this.absCameraSamples = Math.round(Math.abs(this.cameraSamples));
    }

    private lock() {
        if (!this.locked) {
            this.locked = true;
            postMessage(TraceJob.LOCKED);
        }
    }

    run():void {

        this.iterations++;
        var hitSamples = this.hitSamples;
        var cameraSamples = this.cameraSamples;
        var absCameraSamples = this.absCameraSamples;
        if (this.iterations == 1) {
            hitSamples = 1;
            cameraSamples = -1;
            absCameraSamples = Math.round(Math.abs(cameraSamples));
        }

        //console.time("render");
        for (var y:number = this.yoffset; y < this.yoffset + this.height; y++) {

            for (var x:number = this.xoffset; x < this.xoffset + this.width; x++) {

                if (this.flags[3 + this.id] === 2) {//thread locked
                    console.log("exit:3");
                    this.lock();
                    return;
                }

                var screen_index:number = (y * (this.full_width * 3)) + (x * 3);
                // var _x:number = x - this.xoffset;
                // var _y:number = y - this.yoffset;

                var c = new xray.Color3();

                if (cameraSamples <= 0) {
                    // random subsampling
                    for (let i = 0; i < absCameraSamples; i++) {
                        var fu = Math.random();
                        var fv = Math.random();
                        let ray = xray.Camera.CastRay(this.camera, x, y, this.full_width, this.full_height, fu, fv);
                        let sample = this.sampler.sample(this.scene, ray, true, this.sampler.FirstHitSamples, 1);
                        c = c.add(sample);
                    }
                    c = c.divScalar(absCameraSamples);
                } else {
                    // stratified subsampling
                    var n:number = Math.round(Math.sqrt(cameraSamples));
                    for (var u = 0; u < n; u++) {
                        for (var v = 0; v < n; v++) {
                            var fu = (u + 0.5) / n;
                            var fv = (v + 0.5) / n;
                            let ray = xray.Camera.CastRay(this.camera, x, y, this.full_width, this.full_height, fu, fv);
                            let sample = this.sampler.sample(this.scene, ray, true, this.sampler.FirstHitSamples, 1);
                            c = c.add(sample);
                        }
                    }
                    c = c.divScalar(n * n);
                }

                if (this.flags[3 + this.id] === 2) {//thread locked
                    console.log("exit:7");
                    this.lock();
                    return;
                }

                c = c.pow(1 / 2.2);

                this.updatePixel(c, screen_index);
            }
        }
        //console.timeEnd("render");
    }

    updatePixel(color, si:number):void {

        if (this.flags[3 + this.id] === 2) {//thread locked
            console.log("exit:8");
            this.lock();
            return;
        }
        this.sampleMemory[si] += color.R;
        this.sampleMemory[si + 1] += color.G;
        this.sampleMemory[si + 2] += color.B;

        this.pixelMemory[si] = Math.max(0, Math.min(255, (this.sampleMemory[si] / this.iterations) * 255));
        this.pixelMemory[si + 1] = Math.max(0, Math.min(255, (this.sampleMemory[si + 1] / this.iterations) * 255));
        this.pixelMemory[si + 2] = Math.max(0, Math.min(255, (this.sampleMemory[si + 2] / this.iterations) * 255));

    }

    checkSamples() {
        for (var y:number = this.yoffset; y < this.yoffset + this.height; y++) {
            for (var x:number = this.xoffset; x < this.xoffset + this.width; x++) {
                var si:number = (y * (this.full_width * 3)) + (x * 3);
                if (this.sampleMemory[si] !== 0 &&
                    this.sampleMemory[si + 1] !== 0 &&
                    this.sampleMemory[si + 2] !== 0) {
                    return "NOT_OK";
                }
            }
        }
        return "OK";
    }

    drawColor(i:number, rgba:RGBA):void {

        this.pixelMemory[i] = rgba.r;
        this.pixelMemory[i + 1] = rgba.g;
        this.pixelMemory[i + 2] = rgba.b;

    }

    drawPixelInt(i:number, color:number) {

        var red = (color >> 16) & 255;
        var green = (color >> 8) & 255;
        var blue = color & 255;

        this.pixelMemory[i] = red;
        this.pixelMemory[i + 1] = green;
        this.pixelMemory[i + 2] = blue;
    }
}
new TraceWorkerDebug();