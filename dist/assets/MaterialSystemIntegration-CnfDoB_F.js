import{C as v,aA as w,x as b,s as x,ax as S,ay as T,aU as P,o as z,ai as E,am as D}from"./three-CH6znIGP.js";class f{constructor(e){this.engine=e,this.deviceTier=this.detectDeviceTier(),this.proceduralMaterials=new Map,this.qualitySettings=this.initializeQualitySettings(),this.materialCache=new Map,this.carpetMaterialParams={baseColor:new v(8930559),patternScale:this.deviceTier==="low"?2:4,detailLevel:this.qualitySettings.proceduralDetail,glowIntensity:this.deviceTier==="low"?.3:.5},this.trailMaterialParams={baseOpacity:this.deviceTier==="low"?.4:.7,glowIntensity:this.deviceTier==="low"?.3:.5,particleSize:this.deviceTier==="low"?.07:.1},this.stats={proceduralTexturesGenerated:0,cacheHits:0,cacheMisses:0,peakMemoryUsage:0},this.initializeMaterials()}detectDeviceTier(){const e=document.createElement("canvas"),t=e.getContext("webgl2")||e.getContext("webgl");if(!t)return"low";const i=t.getParameter(t.MAX_TEXTURE_SIZE)>=8192&&t.getParameter(t.MAX_RENDERBUFFER_SIZE)>=8192&&navigator.hardwareConcurrency>=4,o=t.getParameter(t.MAX_TEXTURE_SIZE)<=2048||t.getParameter(t.MAX_RENDERBUFFER_SIZE)<=2048||navigator.deviceMemory<=2||/Mobile|Android|iPhone/i.test(navigator.userAgent);return i?"high":o?"low":"medium"}initializeQualitySettings(){return{high:{textureSize:2048,proceduralDetail:1,mipLevels:8,anisotropy:16,shaderComplexity:"high"},medium:{textureSize:1024,proceduralDetail:.7,mipLevels:6,anisotropy:8,shaderComplexity:"medium"},low:{textureSize:512,proceduralDetail:.4,mipLevels:4,anisotropy:4,shaderComplexity:"low"}}[this.deviceTier]}initializeMaterials(){this.createCarpetMaterial(),this.createTrailMaterials()}createCarpetMaterial(){const e=this.generateProceduralTexture("carpet",{size:this.qualitySettings.textureSize,detail:this.carpetMaterialParams.patternScale,color:this.carpetMaterialParams.baseColor}),t=new w({uniforms:{baseTexture:{value:e},glowIntensity:{value:this.carpetMaterialParams.glowIntensity},time:{value:0}},vertexShader:this.getCarpetVertexShader(),fragmentShader:this.getCarpetFragmentShader()});this.materialCache.set("carpet",t)}createTrailMaterials(){const e=new b({color:8978431,transparent:!0,opacity:this.trailMaterialParams.baseOpacity,depthWrite:!1}),t=new x({color:16777215,size:this.trailMaterialParams.particleSize,transparent:!0,opacity:this.trailMaterialParams.baseOpacity,depthWrite:!1,blending:S});this.materialCache.set("trail",e),this.materialCache.set("particle",t)}generateProceduralTexture(e,t){const i=`${e}-${JSON.stringify(t)}`;if(this.proceduralMaterials.has(i))return this.stats.cacheHits++,this.proceduralMaterials.get(i);const o=Math.min(t.size||512,this.qualitySettings.textureSize),n=document.createElement("canvas");n.width=n.height=o;const r=n.getContext("2d");switch(e){case"carpet":this.generateCarpetPattern(r,t);break;case"noise":this.generateNoiseTexture(r,t);break}const a=new T(n);return a.generateMipmaps=!0,a.minFilter=P,a.magFilter=z,a.anisotropy=this.qualitySettings.anisotropy,this.proceduralMaterials.set(i,a),this.stats.proceduralTexturesGenerated++,a}generateCarpetPattern(e,t){const{size:i=512,detail:o=1,color:n=new v(8930559)}=t;e.fillStyle=n.getStyle(),e.fillRect(0,0,i,i);const r=Math.max(2,Math.floor(8*o*this.qualitySettings.proceduralDetail)),a=i/r;for(let l=0;l<r;l++)for(let c=0;c<r;c++){const m=(c+l*r)*137.5,h=.1+Math.abs(Math.sin(m))*.2;e.fillStyle=`rgba(255,255,255,${h})`,e.fillRect(c*a,l*a,a,a),this.deviceTier!=="low"&&(e.strokeStyle=`rgba(255,255,255,${h*.5})`,e.lineWidth=1,e.beginPath(),e.moveTo(c*a,l*a),e.lineTo((c+1)*a,l*a),e.stroke())}}generateNoiseTexture(e,t){const{size:i=512,scale:o=1,octaves:n=4}=t,r=e.createImageData(i,i);for(let a=0;a<i;a++)for(let l=0;l<i;l++){let c=0,m=1,g=o;for(let u=0;u<n*this.qualitySettings.proceduralDetail;u++)c+=this.perlinNoise(l*g/i,a*g/i)*m,m*=.5,g*=2;const h=(a*i+l)*4,s=Math.floor((c+1)*127.5);r.data[h]=s,r.data[h+1]=s,r.data[h+2]=s,r.data[h+3]=255}e.putImageData(r,0,0)}perlinNoise(e,t){const i=Math.floor(e)&255,o=Math.floor(t)&255;e-=Math.floor(e),t-=Math.floor(t);const n=s=>s*s*s*(s*(s*6-15)+10),r=(s,u,p)=>u+s*(p-u),a=(s,u,p)=>{const d=s&15,y=1+(d&7),C=d&8?-1:1;return y*u+C*p},l=new Array(512);for(let s=0;s<256;s++)l[s]=l[s+256]=s*16807%256;const c=n(e),m=n(t),g=l[i]+o,h=l[i+1]+o;return r(m,r(c,a(l[g],e,t),a(l[h],e-1,t)),r(c,a(l[g+1],e,t-1),a(l[h+1],e-1,t-1)))}getCarpetVertexShader(){return`
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            
            void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                
                vNormal = normalize(normalMatrix * normal);
                vViewPosition = -mvPosition.xyz;
            }
        `}getCarpetFragmentShader(){switch(this.qualitySettings.shaderComplexity){case"low":return this.getLowQualityCarpetShader();case"medium":return this.getMediumQualityCarpetShader();case"high":return this.getHighQualityCarpetShader();default:return this.getMediumQualityCarpetShader()}}getLowQualityCarpetShader(){return`
            uniform sampler2D baseTexture;
            uniform float glowIntensity;
            varying vec2 vUv;
            
            void main() {
                vec4 texColor = texture2D(baseTexture, vUv);
                gl_FragColor = texColor;
            }
        `}getMediumQualityCarpetShader(){return`
            uniform sampler2D baseTexture;
            uniform float glowIntensity;
            uniform float time;
            
            varying vec2 vUv;
            varying vec3 vNormal;
            
            void main() {
                vec4 texColor = texture2D(baseTexture, vUv);
                
                // Add simple lighting
                float lightIntensity = max(dot(vNormal, vec3(0.0, 1.0, 0.0)), 0.3);
                
                // Add subtle glow
                float glow = sin(time) * 0.5 + 0.5;
                vec3 finalColor = texColor.rgb * lightIntensity + (texColor.rgb * glow * glowIntensity);
                
                gl_FragColor = vec4(finalColor, texColor.a);
            }
        `}getHighQualityCarpetShader(){return`
            uniform sampler2D baseTexture;
            uniform float glowIntensity;
            uniform float time;
            
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            
            void main() {
                vec4 texColor = texture2D(baseTexture, vUv);
                
                // Enhanced lighting with fresnel effect
                vec3 viewDir = normalize(vViewPosition);
                float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
                
                // Multi-layered lighting
                float directLight = max(dot(vNormal, vec3(0.0, 1.0, 0.0)), 0.3);
                float rimLight = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.0) * 0.5;
                float lightIntensity = directLight + rimLight;
                
                // Complex glow effect
                float timeScale = time * 0.5;
                float glow = sin(timeScale) * 0.3 + cos(timeScale * 0.7) * 0.2 + 0.5;
                float patternGlow = sin(vUv.x * 20.0 + time) * sin(vUv.y * 20.0 + time) * 0.1;
                
                // Combine effects
                vec3 finalColor = texColor.rgb * lightIntensity;
                finalColor += texColor.rgb * (glow + patternGlow) * glowIntensity;
                finalColor += fresnel * texColor.rgb * 0.3;
                
                gl_FragColor = vec4(finalColor, texColor.a);
            }
        `}getMaterial(e){return this.materialCache.get(e)}updateMaterials(e){const t=this.materialCache.get("carpet");t&&t.uniforms&&(t.uniforms.time.value=e)}disposeTexture(e,t){const i=`${e}-${JSON.stringify(t)}`;this.proceduralMaterials.has(i)&&(this.proceduralMaterials.get(i).dispose(),this.proceduralMaterials.delete(i))}resetMaterials(){console.log("Resetting materials due to visibility change"),this.proceduralMaterials.forEach((e,t)=>{e&&e.needsUpdate!==void 0&&(e.needsUpdate=!0)}),this.materialCache.forEach(e=>{e.uniforms&&(e.uniforms.time&&(e.uniforms.time.value=0),Object.values(e.uniforms).forEach(t=>{t.value&&t.value.isTexture&&(t.value.needsUpdate=!0)}))})}dispose(){this.materialCache.forEach(e=>{e.uniforms&&Object.values(e.uniforms).forEach(t=>{t.value&&t.value.isTexture&&t.value.dispose()}),e.dispose()}),this.proceduralMaterials.forEach(e=>{e.dispose()}),this.materialCache.clear(),this.proceduralMaterials.clear()}}class I{constructor(e){this.engine=e,this.materialManager=new f(e)}async initialize(){this.integrateWithCarpetTrail(),this.integrateWithCarpetController()}integrateWithCarpetTrail(){const e=this.engine.systems.carpetTrail;if(!e||["initialize","createParticle","createSteamParticle","updateRibbonTrail","initializePools"].some(r=>typeof e[r]!="function"))return;e.initialize.bind(e),e.initialize=()=>{console.log("Using optimized materials for carpet trail"),e.particleGeometry=new E(.1,e.isMobile?3:4,e.isMobile?3:4),e.steamGeometry=new D(.5,.5),e.particleMaterial=this.materialManager.getMaterial("particle").clone(),e.ribbonMaterial=this.materialManager.getMaterial("trail").clone(),e.motionLineMaterial=this.materialManager.getMaterial("trail").clone(),e.steamMaterial=this.materialManager.getMaterial("particle").clone(),e.initializePools()};const i=e.createParticle.bind(e);e.createParticle=r=>{const a=i(r);return a&&(a.material=this.materialManager.getMaterial("particle").clone()),a};const o=e.createSteamParticle.bind(e);e.createSteamParticle=r=>{const a=o(r);return a&&(a.material=this.materialManager.getMaterial("particle").clone(),a.material.opacity=.4),a};const n=e.updateRibbonTrail.bind(e);e.updateRibbonTrail=r=>{const a=n(r);return e.ribbonMesh&&(e.ribbonMesh.material=this.materialManager.getMaterial("trail").clone()),a}}integrateWithCarpetController(){const e=this.engine.systems.player?.localPlayer;if(!e)return;const t=e.getObjectByName("carpet");t&&(t.material=this.materialManager.getMaterial("carpet"))}update(e){this.materialManager.updateMaterials(this.engine.elapsed)}reoptimizeMaterials(){console.log("Reoptimizing materials for new device capabilities");const e=new Map(this.materialManager.materialCache);this.materialManager=new f(this.engine),this.integrateWithCarpetTrail(),this.integrateWithCarpetController(),setTimeout(()=>{e.forEach(t=>{t.uniforms&&Object.values(t.uniforms).forEach(i=>{i.value&&i.value.isTexture&&i.value.dispose()}),t.dispose()})},1e3)}dispose(){this.materialManager.dispose()}}export{I as MaterialSystemIntegration};
