class h{constructor(e){this.engine=e||{qualityManager:{uiAnimationLevel:"low"}},this.uiElements=new Map,this.visibleElements=new Set,this.touchElements=new Map,this.elementPool=new Map,this.batterySaving=!1,this.screenWidth=window.innerWidth,this.screenHeight=window.innerHeight,this.orientationLayout=this.screenWidth>this.screenHeight?"landscape":"portrait",this.devicePixelRatio=window.devicePixelRatio||1,this.hasHapticFeedback="vibrate"in navigator,this.isDeviceSmall=Math.min(this.screenWidth,this.screenHeight)<600,this.frameCounter=0,this.batteryUpdateFrequency=1,this.sizes={buttonSize:this.isDeviceSmall?70:80,joystickSize:this.isDeviceSmall?130:150,healthBarWidth:Math.min(320,this.screenWidth*.6),spacing:this.isDeviceSmall?10:15},this.memoryUsage={elementsCreated:0,activeElements:0,poolSize:0},this.visible=!0,window.addEventListener("resize",this.onResize.bind(this))}initialize(){this.createUIContainer(),this.createSimpleControls(),this.createBatterySavingToggle(),this.setupCameraControls(),this.ensureMobileMinimapVisibility(),console.log("Mobile UI initialized with simplified user controls")}createUIContainer(){const e=document.createElement("div");e.id="mobile-ui-container",e.style.cssText=`
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1000;
            touch-action: none;
        `,document.body.appendChild(e),this.uiElements.set("container",e),this.uiContainer=e;const t=()=>{document.documentElement.style.setProperty("--vh",`${window.innerHeight*.01}px`),e.style.height="calc(var(--vh, 1vh) * 100)"};window.addEventListener("resize",t),t()}touchOnUIElement(e){const t=e.changedTouches[0],i=t.clientX,n=t.clientY;for(const[s,a]of this.touchElements.entries())if(a.type==="button"||a.type==="toggle"){const o=a.element;if(!o)continue;const r=o.getBoundingClientRect();if(i>=r.left&&i<=r.right&&n>=r.top&&n<=r.bottom)return!0}return!1}setupCameraControls(){const e=this.getElementFromPool("div")||document.createElement("div");e.id="camera-controls",e.style.cssText=`
            position: fixed;
            top: 0;
            left: 0;
            width: 100%; /* Full screen */
            height: 100%;
            z-index: 500; /* Below other UI controls */
            pointer-events: auto;
            touch-action: none;
            user-select: none;
        `,this.cameraState={active:!1,lastX:0,lastY:0,deltaX:0,deltaY:0,touchId:null,startX:0,startY:0},e.addEventListener("touchstart",i=>{if(this.touchOnUIElement(i)||(i.preventDefault(),this.cameraState.active))return;const n=i.changedTouches[0];this.cameraState.touchId=n.identifier,this.cameraState.active=!0,this.cameraState.lastX=n.clientX,this.cameraState.lastY=n.clientY,this.cameraState.startX=n.clientX,this.cameraState.startY=n.clientY,this.cameraState.deltaX=0,this.cameraState.deltaY=0}),e.addEventListener("touchmove",i=>{if(this.cameraState.active){i.preventDefault();for(let n=0;n<i.changedTouches.length;n++){const s=i.changedTouches[n];if(s.identifier===this.cameraState.touchId){const a=s.clientX-this.cameraState.lastX,o=s.clientY-this.cameraState.lastY;this.cameraState.lastX=s.clientX,this.cameraState.lastY=s.clientY,this.cameraState.deltaX=a*1,this.cameraState.deltaY=o*1,this.engine&&this.engine.input&&this.engine.input.emit("mobileCameraMove",{deltaX:this.cameraState.deltaX,deltaY:this.cameraState.deltaY});break}}}});const t=i=>{if(!this.cameraState.active)return;i.preventDefault();let n=!1;for(let s=0;s<i.changedTouches.length;s++){const a=i.changedTouches[s];if(a.identifier===this.cameraState.touchId){n=!0,Math.sqrt(Math.pow(a.clientX-this.cameraState.startX,2)+Math.pow(a.clientY-this.cameraState.startY,2))<10&&this.engine&&this.engine.input&&this.engine.input.emit("mobileTap",{x:a.clientX,y:a.clientY});break}}n&&(this.cameraState.active=!1,this.cameraState.touchId=null,this.cameraState.deltaX=0,this.cameraState.deltaY=0,this.engine&&this.engine.input&&this.engine.input.emit("mobileCameraMove",{deltaX:0,deltaY:0}))};e.addEventListener("touchend",t),e.addEventListener("touchcancel",t),this.uiContainer.appendChild(e),this.uiElements.set("cameraControls",e),this.visibleElements.add("cameraControls"),this.memoryUsage.activeElements+=1}createSimpleControls(){const e=this.getElementFromPool("div")||document.createElement("div");e.id="simple-controls",e.style.cssText=`
            position: fixed;
            bottom: 40px;
            left: 20px;
            display: flex;
            flex-direction: column;
            gap: 20px;
            z-index: 1000;
            pointer-events: none;
        `;const t=this.getElementFromPool("div")||document.createElement("div");t.id="forward-button",t.style.cssText=`
            width: 80px;
            height: 80px;
            background: rgba(30, 144, 255, 0.3);
            border: 2px solid rgba(255, 255, 255, 0.6);
            border-radius: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 30px;
            pointer-events: auto;
            text-shadow: 0 0 4px rgba(0, 0, 0, 0.7);
            user-select: none;
        `,t.textContent="W";const i=this.getElementFromPool("div")||document.createElement("div");i.id="backward-button",i.style.cssText=`
            width: 80px;
            height: 80px;
            background: rgba(160, 160, 160, 0.3);
            border: 2px solid rgba(255, 255, 255, 0.6);
            border-radius: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 30px;
            pointer-events: auto;
            text-shadow: 0 0 4px rgba(0, 0, 0, 0.7);
            user-select: none;
        `,i.textContent="S",t.addEventListener("touchstart",s=>{s.preventDefault(),t.style.background="rgba(30, 144, 255, 0.7)",this.engine&&this.engine.input&&this.engine.input.keys&&(this.engine.input.keys.KeyW=!0,this.engine.input.keys.KeyS=!1),this.engine&&this.engine.systems&&this.engine.systems.player&&this.engine.systems.player.input&&(this.engine.systems.player.input.currentThrottle=1),this.triggerHapticFeedback("button")}),t.addEventListener("touchend",s=>{s.preventDefault(),t.style.background="rgba(30, 144, 255, 0.3)",this.engine&&this.engine.input&&this.engine.input.keys&&(this.engine.input.keys.KeyW=!1),this.engine&&this.engine.systems&&this.engine.systems.player&&this.engine.systems.player.input&&(this.engine.systems.player.input.currentThrottle=0)}),i.addEventListener("touchstart",s=>{s.preventDefault(),i.style.background="rgba(160, 160, 160, 0.7)",this.engine&&this.engine.input&&this.engine.input.keys&&(this.engine.input.keys.KeyS=!0,this.engine.input.keys.KeyW=!1),this.triggerHapticFeedback("button")}),i.addEventListener("touchend",s=>{s.preventDefault(),i.style.background="rgba(160, 160, 160, 0.3)",this.engine&&this.engine.input&&this.engine.input.keys&&(this.engine.input.keys.KeyS=!1)});const n=this.getElementFromPool("div")||document.createElement("div");n.style.cssText=`
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `,n.appendChild(t),n.appendChild(i),e.appendChild(n),this.uiContainer.appendChild(e),this.uiElements.set("controlsContainer",e),this.uiElements.set("forwardButton",t),this.uiElements.set("backwardButton",i),this.visibleElements.add("controlsContainer"),this.touchElements.set("forward-button",{element:t,type:"button",action:"forward"}),this.touchElements.set("backward-button",{element:i,type:"button",action:"backward"}),this.memoryUsage.activeElements+=3}createBatterySavingToggle(){const e=this.getElementFromPool("div")||document.createElement("div");e.id="battery-toggle",e.style.cssText=`
            position: fixed;
            top: ${this.sizes.spacing}px;
            right: ${this.sizes.spacing}px;
            display: flex;
            align-items: center;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 20px;
            padding: 4px 8px;
            z-index: 1000;
            pointer-events: auto;
        `;const t=this.getElementFromPool("div")||document.createElement("div");t.textContent="Power Save",t.style.cssText=`
            color: white;
            font-size: 12px;
            margin-right: 5px;
        `;const i=this.getElementFromPool("div")||document.createElement("div");i.style.cssText=`
            width: 30px;
            height: 16px;
            background: #555;
            border-radius: 8px;
            position: relative;
            transition: background 0.3s;
        `;const n=this.getElementFromPool("div")||document.createElement("div");n.style.cssText=`
            position: absolute;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: white;
            top: 2px;
            left: 2px;
            transition: transform 0.3s;
        `,i.appendChild(n),e.appendChild(t),e.appendChild(i),this.uiContainer.appendChild(e),this.uiElements.set("batterySaver",e),this.uiElements.set("batterySaverToggle",i),this.uiElements.set("batterySaverHandle",n),this.visibleElements.add("batterySaver"),this.memoryUsage.activeElements+=3,i.addEventListener("touchend",s=>{s.preventDefault(),this.toggleBatterySavingMode(),this.triggerHapticFeedback("toggle")}),this.touchElements.set("battery-toggle",{element:i,type:"toggle",action:"battery"})}ensureMobileMinimapVisibility(){setTimeout(()=>{const e=document.getElementById("minimap-container");if(e)e.style.position="absolute",e.style.top="10px",e.style.left="10px",e.style.width="100px",e.style.height="100px",e.style.zIndex="1500",e.style.display="block",e.style.opacity="1",e.style.visibility="visible",console.log("Mobile minimap visibility enforced");else{console.warn("Minimap container not found, creating it manually");const t=document.createElement("div");t.id="minimap-container",t.style.cssText=`
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    width: 100px;
                    height: 100px;
                    border-radius: 50%;
                    overflow: hidden;
                    background-color: rgba(0, 0, 20, 0.5);
                    border: 2px solid rgba(255, 255, 255, 0.5);
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
                    z-index: 1500;
                    display: block;
                    opacity: 1;
                    visibility: visible;
                `,this.uiContainer.appendChild(t)}},1e3)}toggleBatterySavingMode(){this.batterySaving=!this.batterySaving;const e=this.uiElements.get("batterySaverToggle"),t=this.uiElements.get("batterySaverHandle");this.batterySaving?(e.style.background="#4CAF50",t.style.transform="translateX(16px)",this.applyBatterySavingMode(!0)):(e.style.background="#555",t.style.transform="translateX(0)",this.applyBatterySavingMode(!1))}applyBatterySavingMode(e){e?(document.documentElement.style.setProperty("--ui-animation-speed","0.5"),this.uiElements.forEach(t=>{t.style&&t.style.backdropFilter&&(t.style.backdropFilter="none"),t.style&&t.style.boxShadow&&(t.style.boxShadow="none")}),this.batteryUpdateFrequency=3):(document.documentElement.style.setProperty("--ui-animation-speed","1"),this.batteryUpdateFrequency=1),this.engine&&(typeof this.engine.setBatterySavingMode=="function"?this.engine.setBatterySavingMode(e):this.engine.qualityManager&&(this.engine.qualityManager.targetFPS=e?30:60))}triggerHapticFeedback(e){if(!(!this.hasHapticFeedback||this.batterySaving))switch(e){case"button":navigator.vibrate(20);break;case"toggle":navigator.vibrate(15);break;case"boost":navigator.vibrate([20,30,40]);break;default:navigator.vibrate(25)}}onResize(){this.screenWidth=window.innerWidth,this.screenHeight=window.innerHeight}getElementFromPool(e){this.elementPool.has(e)||this.elementPool.set(e,[]);const t=this.elementPool.get(e);if(t.length>0){const i=t.pop();return this.memoryUsage.poolSize--,i}return this.memoryUsage.elementsCreated++,null}returnElementToPool(e){if(!e)return;e.parentNode&&e.parentNode.removeChild(e),e.className="",e.id="",e.textContent="",e.innerHTML="",e.removeAttribute("style"),e.replaceWith(e.cloneNode(!1));const t=e.tagName.toLowerCase();this.elementPool.has(t)||this.elementPool.set(t,[]),this.elementPool.get(t).push(e),this.memoryUsage.poolSize++,this.memoryUsage.activeElements--}update(e,t){try{if(this.frameCounter===void 0&&(this.frameCounter=0),this.batterySaving&&this.frameCounter++%(this.batteryUpdateFrequency||1)!==0)return;if(this.frameCounter%60===0){const i=document.getElementById("minimap-container");i&&(i.style.display==="none"||!i.isConnected)&&this.ensureMobileMinimapVisibility()}}catch(i){console.warn("Error updating mobile UI:",i)}}dispose(){this.uiElements.forEach(e=>{e&&e.parentNode&&this.returnElementToPool(e)}),this.uiElements.clear(),this.visibleElements.clear(),this.touchElements.clear(),window.removeEventListener("resize",this.onResize),console.log("Mobile UI disposed with memory stats:",this.memoryUsage)}}export{h as MobileUI};
