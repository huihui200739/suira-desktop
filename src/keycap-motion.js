'use strict';

// Immediate light feedback; only the stronger pose and single reflection wait 40ms.
// Cache the stationary hit box on entry. Pointer frames never read moving geometry.
(() => {
  function attach(root, { suspended = () => false } = {}) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const touched = new Set(), lastSweep = new WeakMap(), tails = new Map();
    let active=null, pressed=null, point=null, box=null, dwell=0, frame=0, pulseTimer=0;
    const keyFrom=node=>{const key=node?.closest?.('.key');return key&&root.contains(key)&&!key.disabled&&key.dataset.state!=='unimplemented'?key:null;};
    function release(){pressed?.classList.remove('is-key-pressed');pressed=null;clearTimeout(pulseTimer);pulseTimer=0;}
    function leave(feedback=true){
      clearTimeout(dwell);cancelAnimationFrame(frame);dwell=frame=0;
      active?.classList.remove('is-key-near','is-key-hover','is-key-sheen');
      active?.style.removeProperty('--key-rx');active?.style.removeProperty('--key-ry');
      if(active&&feedback&&!reduce.matches&&!suspended()){
        const key=active;clearTimeout(tails.get(key));key.classList.add('is-key-trail');
        tails.set(key,setTimeout(()=>{key.classList.remove('is-key-trail');tails.delete(key);},60));
      }
      active=point=box=null;
    }
    function clear(){
      leave(false);release();for(const timer of tails.values())clearTimeout(timer);tails.clear();
      for(const key of touched){key.classList.remove('is-key-near','is-key-hover','is-key-trail','is-key-pressed','is-key-sheen');key.style.removeProperty('--key-rx');key.style.removeProperty('--key-ry');}
      touched.clear();
    }
    function update(){
      frame=0;if(!active||!point||!box||reduce.matches||suspended())return;
      const x=Math.max(-1,Math.min(1,(point.x-box.left)/box.width*2-1));
      const y=Math.max(-1,Math.min(1,(point.y-box.top)/box.width*2-1));
      active.style.setProperty('--key-rx',(-y*2).toFixed(2)+'deg');
      active.style.setProperty('--key-ry',(x*2).toFixed(2)+'deg');
    }
    function enter(event,key){
      if(!key||key===active||event.pointerType==='touch'||reduce.matches||suspended())return;
      leave();clearTimeout(tails.get(key));tails.delete(key);key.classList.remove('is-key-trail');
      active=key;touched.add(key);box=key.getBoundingClientRect();
      point={x:event.clientX,y:event.clientY};key.classList.add('is-key-near');
      // Start the transition now, even if enter/leave arrive before the next
      // paint. This is one style read per entry, never a pointer-frame layout read.
      getComputedStyle(key.querySelector('.key-card')).transform;
      frame=requestAnimationFrame(update);
      dwell=setTimeout(()=>{
        dwell=0;if(active!==key||reduce.matches||suspended())return;
        key.classList.add('is-key-hover');
        if(performance.now()-(lastSweep.get(key)??-Infinity)>=280){
          lastSweep.set(key,performance.now());key.classList.add('is-key-sheen');
        }
      },40);
    }
    root.addEventListener('pointerover',event=>enter(event,keyFrom(event.target)));
    root.addEventListener('pointermove',event=>{
      if(reduce.matches||suspended()){clear();return;}
      const key=keyFrom(event.target);if(!active)enter(event,key);
      if(!active||event.pointerType==='touch')return;
      point={x:event.clientX,y:event.clientY};if(!frame)frame=requestAnimationFrame(update);
    },{passive:true});
    root.addEventListener('pointerout',event=>{if(active&&!active.contains(event.relatedTarget))leave();});
    root.addEventListener('pointerleave',clear);
    root.addEventListener('animationend',event=>{
      if(event.animationName==='keycap-sweep')keyFrom(event.target)?.classList.remove('is-key-sheen');
    });
    root.addEventListener('pointerdown',event=>{
      if(event.button!==0||reduce.matches||suspended())return;
      const key=keyFrom(event.target);if(!key)return;
      release();pressed=key;touched.add(key);key.classList.add('is-key-pressed');key.classList.remove('is-key-sheen');
    });
    document.addEventListener('pointerup',release);document.addEventListener('pointercancel',clear);
    root.addEventListener('keydown',event=>{
      if(![' ','Enter'].includes(event.key)||reduce.matches||suspended())return;
      const key=keyFrom(event.target);if(key){release();pressed=key;touched.add(key);key.classList.add('is-key-pressed');}
    });
    root.addEventListener('keyup',release);root.addEventListener('focusout',clear);
    window.addEventListener('blur',clear);window.addEventListener('resize',clear);
    document.addEventListener('pointerout',event=>{if(!event.relatedTarget)clear();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});reduce.addEventListener('change',clear);
    return {clear,pulse(key){if(!key||reduce.matches||suspended())return;release();pressed=key;touched.add(key);key.classList.add('is-key-pressed');pulseTimer=setTimeout(release,90);}};
  }
  window.SuiraKeycapMotion={attach};
})();
