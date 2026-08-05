import { useState, useRef, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// After deploying the Apps Script, paste the URL here:
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzYx-dBxo7_oktqUV-Yg6bUR0T1JEDZ0PGrudpMIOgegUxhpy9VS_HCXvDkDsTAJ8A/exec";
const SPREADSHEET_ID  = "1PXEUiwnv1pkKrIxwj69FBRSXwKL3m9z05Dlxt24jhBk";
// ─────────────────────────────────────────────────────────────────────────────

// ─── Google Sheets API via Apps Script ───────────────────────────────────────
const db = {
  async call(action, payload = {}) {
    if (APPS_SCRIPT_URL === "PASTE_YOUR_APPS_SCRIPT_URL_HERE") {
      return dbLocal.call(action, payload);
    }
    try {
      // Use GET for read operations (no CORS preflight), POST for writes
      if (action === "getAll") {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=getAll`);
        return await res.json();
      }
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" }, // text/plain avoids CORS preflight
        body: JSON.stringify({ action, ...payload }),
      });
      return await res.json();
    } catch(e) {
      console.warn("Sheets unavailable, using local:", e.message);
      return dbLocal.call(action, payload);
    }
  },
  getAll:       ()       => db.call("getAll"),
  saveProduct:  (p)      => db.call("saveProduct",  { product: p }),
  updateProduct:(id, f)  => db.call("updateProduct",{ id, fields: f }),
  saveKit:      (k)      => db.call("saveKit",      { kit: k }),
  updateKit:    (id, f)  => db.call("updateKit",    { id, fields: f }),
  saveStaging:  (parts)  => db.call("saveStaging",  { parts }),
  removeStaging:(ids)    => db.call("removeStaging",{ ids }),
  logMovement:  (m)      => db.call("logMovement",  { movement: m }),
  bulkLoad:     (data)   => db.call("bulkLoad",     { data }),
};

// ─── LocalStorage fallback (works offline / before Apps Script setup) ─────────
const LS_KEY = "mkj_inv_unified";
const dbLocal = {
  _load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null") || { products:[], kits:[], staging:[], movements:[] }; }
    catch { return { products:[], kits:[], staging:[], movements:[] }; }
  },
  _save(d) { localStorage.setItem(LS_KEY, JSON.stringify(d)); },
  call(action, payload) {
    const d = this._load();
    switch(action) {
      case "getAll": return Promise.resolve({ ok:true, data: d });
      case "saveProduct": {
        d.products.push(payload.product);
        this._save(d);
        return Promise.resolve({ ok:true });
      }
      case "updateProduct": {
        d.products = d.products.map(p => p.id === payload.id ? { ...p, ...payload.fields } : p);
        this._save(d);
        return Promise.resolve({ ok:true });
      }
      case "saveKit": {
        d.kits.push(payload.kit);
        this._save(d);
        return Promise.resolve({ ok:true });
      }
      case "updateKit": {
        d.kits = d.kits.map(k => k.id === payload.id ? { ...k, ...payload.fields } : k);
        this._save(d);
        return Promise.resolve({ ok:true });
      }
      case "saveStaging": {
        d.staging.push(...(payload.parts||[]));
        this._save(d);
        return Promise.resolve({ ok:true });
      }
      case "removeStaging": {
        d.staging = d.staging.filter(p => !(payload.ids||[]).includes(p.id));
        this._save(d);
        return Promise.resolve({ ok:true });
      }
      case "logMovement": {
        d.movements.push(payload.movement);
        this._save(d);
        return Promise.resolve({ ok:true });
      }
      default: return Promise.resolve({ ok:false, error:"Unknown action" });
    }
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const isBarrier = m => m?.toLowerCase().includes("barrier");
const now = () => new Date().toISOString();

// ─── QR local (QRCode.js via CDN) ────────────────────────────────────────────
const loadQRLib = (() => {
  let p = null;
  return () => p || (p = new Promise(res => {
    if (window.QRCode) return res();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = res; document.head.appendChild(s);
  }));
})();

function QRCanvas({ text, size = 120 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !text) return;
    ref.current.innerHTML = "";
    loadQRLib().then(() => {
      try { new window.QRCode(ref.current, { text, width:size, height:size, colorDark:"#000", colorLight:"#fff", correctLevel:window.QRCode.CorrectLevel.M }); } catch {}
    });
  }, [text, size]);
  return <div ref={ref} style={{ width:size, height:size, display:"inline-block" }} />;
}

const generateQRDataUrl = (text, size=200) => new Promise(async res => {
  await loadQRLib();
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(el);
  try {
    new window.QRCode(el, { text, width:size, height:size, colorDark:"#000", colorLight:"#fff" });
    setTimeout(() => {
      const c = el.querySelector("canvas"), img = el.querySelector("img");
      res(c ? c.toDataURL("image/png") : img ? img.src : "");
      document.body.removeChild(el);
    }, 150);
  } catch { document.body.removeChild(el); res(""); }
});

// ─── Label renderer (50×30mm, info left + QR right) ──────────────────────────
const renderLabelToDataUrl = async (item) => {
  const W=472, H=283;
  const canvas = document.createElement("canvas");
  canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="#000"; ctx.lineWidth=2; ctx.strokeRect(1,1,W-2,H-2);
  ctx.strokeStyle="#ddd"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(W-235,0); ctx.lineTo(W-235,H); ctx.stroke();

  const cod = item.isKit ? (item.name||item.codigo) : item.codigo;
  const sn  = item.isKit ? (item.parts||[]).map(p=>p.serial).join(" + ") : item.serial;

  ctx.fillStyle="#bbb"; ctx.font="bold 13px 'Helvetica Neue',Arial";
  ctx.fillText("MKJ TRADE",14,22);
  ctx.fillStyle="#000"; ctx.font=`bold ${cod.length>10?26:32}px 'Helvetica Neue',Arial`;
  ctx.fillText(cod.slice(0,14)+(cod.length>14?"…":""),14,80);
  ctx.fillStyle="#333"; ctx.font="20px 'Courier New',monospace";
  ctx.fillText("SN: "+sn.slice(0,18),14,116);

  const qrDu = await generateQRDataUrl(item.qr_data, 200);
  const qrImg = new Image();
  await new Promise((res,rej)=>{ qrImg.onload=res; qrImg.onerror=rej; qrImg.src=qrDu; });
  ctx.drawImage(qrImg, W-228, 18, 210, 210);
  return canvas.toDataURL("image/png");
};

// ─── Print labels (opens print window) ───────────────────────────────────────
const printLabels = async (items) => {
  const entries = await Promise.all(items.map(async p => ({ ...p, dataUrl: await renderLabelToDataUrl(p) })));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas MKJ</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#fff}
  .page{display:flex;flex-wrap:wrap;padding:4mm;gap:2mm}
  .label{width:50mm;height:30mm;border:.4mm solid #000;page-break-inside:avoid}
  .label img{width:100%;height:100%;display:block}
  @media print{body{margin:0}.page{padding:0;gap:0}}</style>
  </head><body><div class="page">
  ${entries.map(p=>`<div class="label"><img src="${p.dataUrl}"/></div>`).join("")}
  </div><script>window.onload=()=>window.print()<\/script></body></html>`;
  const w = window.open("","_blank");
  if(w){w.document.write(html);w.document.close();}
};

// ─── jsQR loader ──────────────────────────────────────────────────────────────
const loadJsQR = (() => {
  let p = null;
  return () => p || (p = new Promise(res => {
    if (window.jsQR) return res(window.jsQR);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js";
    s.onload = () => res(window.jsQR); document.head.appendChild(s);
  }));
})();

// ─── QR Scanner ───────────────────────────────────────────────────────────────
function QRScanner({ onScan, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const stateRef  = useRef({ stream:null, raf:null, alive:true, jsQR:null });
  const [phase, setPhase] = useState("starting");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const state = stateRef.current;
    state.alive = true;

    // Request camera AND load jsQR simultaneously — do NOT await jsQR before camera
    const cameraPromise = (async () => {
      const constraints = [
        { video: { facingMode: "environment", width:{ideal:1280}, height:{ideal:720} } },
        { video: { facingMode: "environment" } },
        { video: true },
      ];
      for (const c of constraints) {
        try { return await navigator.mediaDevices.getUserMedia(c); } catch {}
      }
      throw new Error("No se pudo acceder a la cámara. Ve a Ajustes → Safari → Cámara → Permitir.");
    })();

    const jsQRPromise = loadJsQR();

    Promise.all([cameraPromise, jsQRPromise]).then(([stream, jsQR]) => {
      if (!state.alive) { stream.getTracks().forEach(t => t.stop()); return; }
      state.stream = stream;
      state.jsQR = jsQR;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.onloadedmetadata = async () => {
        try { await video.play(); } catch {}
        if (!state.alive) return;
        setPhase("scanning");
        const scan = () => {
          if (!state.alive) return;
          const v = videoRef.current, c = canvasRef.current;
          if (v && c && v.readyState >= 2 && v.videoWidth > 0) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = state.jsQR(img.data, img.width, img.height, { inversionAttempts:"dontInvert" });
            if (code?.data) {
              state.alive = false;
              stream.getTracks().forEach(t => t.stop());
              onScan(code.data);
              return;
            }
          }
          state.raf = requestAnimationFrame(scan);
        };
        state.raf = requestAnimationFrame(scan);
      };
    }).catch(e => {
      setErrMsg(e.message || "Error de cámara");
      setPhase("error");
    });

    return () => {
      state.alive = false;
      if (state.raf) cancelAnimationFrame(state.raf);
      if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div style={{position:"fixed",inset:0,background:"#000",zIndex:3000,display:"flex",flexDirection:"column"}}>
      <div style={{background:"#000",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #222"}}>
        <span style={{color:"#fff",fontWeight:700,letterSpacing:1}}>ESCANEAR QR</span>
        <button onClick={()=>{stateRef.current.alive=false;if(stateRef.current.stream)stateRef.current.stream.getTracks().forEach(t=>t.stop());onClose();}} style={{background:"#222",border:"none",color:"#fff",padding:"8px 16px",borderRadius:6,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>✕ Cerrar</button>
      </div>
      <div style={{flex:1,position:"relative",overflow:"hidden"}}>
        <video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover",display:phase==="scanning"?"block":"none"}}/>
        <canvas ref={canvasRef} style={{display:"none"}}/>
        {phase==="scanning" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
            <div style={{width:220,height:220,position:"relative"}}>
              {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h])=>(
                <div key={v+h} style={{position:"absolute",width:28,height:28,[v]:0,[h]:0,
                  borderTop:v==="top"?"3px solid #fff":"none",
                  borderBottom:v==="bottom"?"3px solid #fff":"none",
                  borderLeft:h==="left"?"3px solid #fff":"none",
                  borderRight:h==="right"?"3px solid #fff":"none"}}/>
              ))}
              <div style={{position:"absolute",left:6,right:6,height:2,background:"rgba(255,255,255,.85)",top:"50%",animation:"scan 1.6s ease-in-out infinite"}}/>
            </div>
          </div>
        )}
        {phase==="starting" && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
            <div style={{width:44,height:44,border:"3px solid #333",borderTop:"3px solid #fff",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
            <div style={{color:"#fff",fontSize:14}}>Iniciando cámara...</div>
          </div>
        )}
        {phase==="error" && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,padding:28}}>
            <div style={{fontSize:36}}>📷</div>
            <div style={{color:"#fca5a5",fontSize:14,textAlign:"center",lineHeight:1.6}}>{errMsg}</div>
            <button onClick={()=>{setPhase("starting");setErrMsg("");}} style={{background:"#fff",color:"#000",border:"none",borderRadius:8,padding:"12px 24px",fontFamily:"inherit",fontWeight:700,cursor:"pointer",fontSize:14}}>Reintentar</button>
          </div>
        )}
      </div>
      <div style={{background:"#111",padding:"12px",textAlign:"center",color:"#666",fontSize:12,letterSpacing:1}}>Apunta al QR pegado en el producto</div>
      <style>{`@keyframes scan{0%{top:10%}50%{top:85%}100%{top:10%}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function PhotoCapture({ onCapture, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [phase, setPhase] = useState("starting"); // starting | live | captured | error
  const [captured, setCaptured] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let stream;
        const constraints = [
          { video: { facingMode:"environment", width:{ideal:1920}, height:{ideal:1080} } },
          { video: { facingMode:"environment" } },
          { video: true },
        ];
        for (const c of constraints) {
          try { stream = await navigator.mediaDevices.getUserMedia(c); break; } catch {}
        }
        if (!stream) throw new Error("Sin acceso a cámara");
        if (!alive) { stream.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await new Promise(res => { video.onloadedmetadata = res; });
        await video.play();
        if (alive) setPhase("live");
      } catch(e) { if(alive){setErrMsg(e.message);setPhase("error");} }
    })();
    return () => { alive=false; streamRef.current?.getTracks().forEach(t=>t.stop()); };
  }, []);

  const snap = () => {
    const v=videoRef.current, c=canvasRef.current;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    const data=c.toDataURL("image/jpeg",0.92);
    streamRef.current?.getTracks().forEach(t=>t.stop());
    setCaptured(data); setPhase("captured");
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#000",zIndex:3000,display:"flex",flexDirection:"column"}}>
      <div style={{background:"#000",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #222"}}>
        <span style={{color:"#fff",fontWeight:700,letterSpacing:1}}>FOTO DE DELIVERY NOTE</span>
        <button onClick={onClose} style={{background:"#222",border:"none",color:"#fff",padding:"8px 16px",borderRadius:6,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
      </div>
      <div style={{flex:1,position:"relative",overflow:"hidden"}}>
        <video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover",display:phase==="live"?"block":"none"}}/>
        {captured && <img src={captured} style={{width:"100%",height:"100%",objectFit:"contain"}} alt="preview"/>}
        <canvas ref={canvasRef} style={{display:"none"}}/>
        {phase==="starting" && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
            <div style={{color:"#fff",fontSize:15}}>Iniciando cámara...</div>
            <div style={{width:40,height:40,border:"3px solid #333",borderTop:"3px solid #fff",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
          </div>
        )}
        {phase==="error" && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:24}}>
            <div style={{color:"#fca5a5",fontSize:14,textAlign:"center"}}>{errMsg}</div>
            <div style={{color:"#94a3b8",fontSize:12}}>Ajustes → Safari → Cámara → Permitir</div>
          </div>
        )}
      </div>
      <div style={{background:"#111",padding:"16px 24px",display:"flex",justifyContent:"center",gap:16}}>
        {phase==="live" && <button onClick={snap} style={{background:"#fff",border:"none",borderRadius:"50%",width:64,height:64,fontSize:28,cursor:"pointer"}}>📷</button>}
        {phase==="captured" && <>
          <button onClick={()=>{setCaptured(null);setPhase("starting");}} style={{background:"#333",border:"none",color:"#fff",padding:"12px 24px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>↩ Repetir</button>
          <button onClick={()=>{onCapture(captured);onClose();}} style={{background:"#fff",border:"none",color:"#000",padding:"12px 28px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>✓ Usar</button>
        </>}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── PrintButton ──────────────────────────────────────────────────────────────
function PrintButton({ items, small=false }) {
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    const images = await Promise.all(items.map(async item => ({
      dataUrl: await renderLabelToDataUrl(item),
      label: `${item.isKit?(item.name||item.codigo):item.codigo} · SN:${item.isKit?(item.parts||[]).map(p=>p.serial).join("+"):item.serial}`
    })));
    setLoading(false);
    setModal(images);
  };

  return (
    <>
      <Btn small={small} onClick={generate} disabled={loading}>{loading?"⏳ Generando...":"🖨️ Imprimir etiqueta"}</Btn>
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setModal(null)}>
          <div style={{background:"#fff",borderRadius:16,padding:22,maxWidth:400,width:"100%",maxHeight:"88vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <h3 style={{margin:0,fontSize:16,fontWeight:700}}>Etiquetas listas</h3>
              <button onClick={()=>setModal(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94a3b8"}}>✕</button>
            </div>
            <div style={{background:"#f8fafc",borderRadius:10,padding:12,marginBottom:14,fontSize:12,color:"#475569",lineHeight:1.7}}>
              <strong>En iPhone (app NIIMBOT gratuita):</strong><br/>
              1. Mantén presionada la imagen<br/>
              2. Compartir → NIIMBOT → selecciona B1<br/>
              3. Ajusta a 50×30mm y confirma<br/><br/>
              <strong>En Mac/PC:</strong> toca "Abrir para imprimir"
            </div>
            {modal.map((img,i)=>(
              <div key={i} style={{marginBottom:14,textAlign:"center"}}>
                <img src={img.dataUrl} alt={img.label} style={{width:"100%",borderRadius:8,border:"1px solid #e2e8f0"}}/>
                <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:8}}>
                  <a href={img.dataUrl} download={`etiqueta-${i+1}.png`} style={{fontSize:12,color:"#000",fontWeight:600,textDecoration:"underline"}}>↓ Descargar</a>
                  <button onClick={()=>printLabels(items)} style={{fontSize:12,color:"#000",fontWeight:600,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Abrir para imprimir</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
const Badge = ({children,color="#e2e8f0",text="#1e293b"}) => (
  <span style={{background:color,color:text,borderRadius:6,padding:"2px 10px",fontSize:12,fontWeight:600,letterSpacing:.3}}>{children}</span>
);
const Btn = ({children,onClick,variant="primary",disabled,small,style={}}) => {
  const v={primary:{background:"#000",color:"#fff",borderRadius:0,letterSpacing:.5},secondary:{background:"#f1f5f9",color:"#0f172a",borderRadius:6},success:{background:"#dcfce7",color:"#16a34a",borderRadius:6},outline:{background:"transparent",color:"#000",border:"1.5px solid #000",borderRadius:0},danger:{background:"#fee2e2",color:"#dc2626",borderRadius:6}};
  return <button style={{border:"none",cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:600,transition:"all .15s",opacity:disabled?.45:1,display:"inline-flex",alignItems:"center",gap:6,padding:small?"6px 14px":"10px 20px",fontSize:small?13:14,...v[variant],...style}} onClick={onClick} disabled={disabled}>{children}</button>;
};
const Card = ({children,style={}}) => <div style={{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",padding:20,...style}}>{children}</div>;
const Input = ({label,...props}) => (
  <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {label&&<label style={{fontSize:12,fontWeight:600,color:"#64748b"}}>{label}</label>}
    <input {...props} style={{border:"1.5px solid #e2e8f0",borderRadius:8,padding:"8px 12px",fontSize:14,fontFamily:"inherit",outline:"none",background:"#fafafa",color:"#0f172a",...props.style}}/>
  </div>
);
const Modal = ({open,onClose,title,children}) => {
  if(!open) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:14,padding:24,maxWidth:600,width:"100%",maxHeight:"88vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:700}}>{title}</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1500,
      system:"Extrae datos de documentos logísticos. Responde solo JSON válido.",
      messages})
  });
  const d = await res.json();
  return d.content?.find(b=>b.type==="text")?.text||"";
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = ["📥 Entrada","📤 Salida","📦 Inventario","🧩 Kits","📊 Historial"];

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState({ products:[], kits:[], staging:[], movements:[] });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [dbMode, setDbMode] = useState("local"); // local | sheets

  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  // Load all data on mount
  useEffect(() => {
    (async () => {
      const res = await db.getAll();
      if (res?.ok && res.data) {
        setData(res.data);
        setDbMode(APPS_SCRIPT_URL !== "PASTE_YOUR_APPS_SCRIPT_URL_HERE" ? "sheets" : "local");
      }
      setLoading(false);
    })();
  }, []);

  // Optimistic update helpers
  const addProduct = async (p) => {
    setData(d => ({...d, products:[...d.products, p]}));
    await db.saveProduct(p);
  };
  const updateProduct = async (id, fields) => {
    setData(d => ({...d, products:d.products.map(p=>p.id===id?{...p,...fields}:p)}));
    await db.updateProduct(id, fields);
  };
  const addKit = async (k) => {
    setData(d => ({...d, kits:[...d.kits, k]}));
    await db.saveKit(k);
  };
  const updateKit = async (id, fields) => {
    setData(d => ({...d, kits:d.kits.map(k=>k.id===id?{...k,...fields}:k)}));
    await db.updateKit(id, fields);
  };
  const addToStaging = async (parts) => {
    setData(d => ({...d, staging:[...d.staging, ...parts]}));
    await db.saveStaging(parts);
  };
  const removeFromStaging = async (ids) => {
    setData(d => ({...d, staging:d.staging.filter(p=>!ids.includes(p.id))}));
    await db.removeStaging(ids);
  };
  const logMovement = async (m) => {
    setData(d => ({...d, movements:[...d.movements, m]}));
    await db.logMovement(m);
  };

  const stagingCount = data.staging?.length || 0;
  const inStock = (data.products||[]).filter(p=>p.status==="en_stock").length +
                  (data.kits||[]).filter(k=>k.status==="en_stock").length;

  const ctx = { data, addProduct, updateProduct, addKit, updateKit, addToStaging, removeFromStaging, logMovement, showToast, setTab };

  if (loading) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#000",flexDirection:"column",gap:16}}>
      <svg width="64" height="64" viewBox="0 0 52 52" fill="none">
        <circle cx="26" cy="26" r="23" stroke="#fff" strokeWidth="2" fill="none"/>
        <text x="8" y="33" fontFamily="Arial" fontWeight="700" fontSize="16" fill="#fff">MKJ</text>
      </svg>
      <div style={{color:"#666",fontSize:13,letterSpacing:2}}>CARGANDO INVENTARIO...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f5f5f5",fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      {/* Header */}
      <div style={{background:"#000",color:"#fff",padding:"14px 20px",display:"flex",alignItems:"center",gap:14}}>
        <svg width="46" height="46" viewBox="0 0 52 52" fill="none">
          <circle cx="26" cy="26" r="23" stroke="#fff" strokeWidth="2" fill="none"/>
          <text x="8" y="33" fontFamily="'Helvetica Neue',Arial" fontWeight="700" fontSize="16" fill="#fff">M</text>
          <text x="20" y="33" fontFamily="'Helvetica Neue',Arial" fontWeight="700" fontSize="16" fill="#fff">K</text>
          <text x="32" y="33" fontFamily="'Helvetica Neue',Arial" fontWeight="700" fontSize="16" fill="#fff">J</text>
        </svg>
        <div style={{borderLeft:"1px solid #333",paddingLeft:14}}>
          <div style={{fontWeight:300,fontSize:17,letterSpacing:6,textTransform:"uppercase"}}>TRADE</div>
          <div style={{fontSize:9,color: dbMode==="sheets"?"#4ade80":"#666",letterSpacing:2,textTransform:"uppercase",marginTop:1}}>
            {dbMode==="sheets"?"● Google Sheets":"● Local Storage"}
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:20,fontWeight:700}}>{inStock}</div>
            <div style={{fontSize:9,color:"#666",letterSpacing:1,textTransform:"uppercase"}}>en stock</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{background:"#fff",borderBottom:"1.5px solid #e5e5e5",display:"flex",overflowX:"auto",padding:"0 16px"}}>
        {TABS.map((t,i)=>(
          <button key={i} onClick={()=>setTab(i)} style={{position:"relative",border:"none",background:"none",padding:"13px 14px",cursor:"pointer",fontWeight:tab===i?700:400,color:tab===i?"#000":"#999",borderBottom:tab===i?"2.5px solid #000":"2.5px solid transparent",fontSize:12,fontFamily:"inherit",whiteSpace:"nowrap",letterSpacing:.3}}>
            {t}
            {i===3&&stagingCount>0&&<span style={{position:"absolute",top:8,right:4,background:"#dc2626",color:"#fff",borderRadius:10,fontSize:9,padding:"1px 5px",fontWeight:700}}>{stagingCount}</span>}
          </button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:900,margin:"0 auto"}}>
        {tab===0&&<EntradaTab ctx={ctx}/>}
        {tab===1&&<SalidaTab ctx={ctx}/>}
        {tab===2&&<InventarioTab ctx={ctx}/>}
        {tab===3&&<KitsTab ctx={ctx}/>}
        {tab===4&&<HistorialTab ctx={ctx}/>}
      </div>

      {toast&&<div style={{position:"fixed",bottom:20,right:20,background:toast.type==="success"?"#000":"#dc2626",color:"#fff",padding:"11px 18px",fontSize:13,fontWeight:500,letterSpacing:.3,boxShadow:"0 4px 20px rgba(0,0,0,.3)",zIndex:4000,borderLeft:"3px solid #fff",maxWidth:320}}>{toast.msg}</div>}
    </div>
  );
}

// ─── ENTRADA TAB ──────────────────────────────────────────────────────────────
function EntradaTab({ ctx }) {
  const { addProduct, addToStaging, logMovement, showToast, setTab } = ctx;
  const [mode, setMode] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [imageData, setImageData] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [printQueue, setPrintQueue] = useState(null);
  const [importText, setImportText] = useState("");
  const [form, setForm] = useState({marca:"",codigo:"",descripcion:"",seriales:"",lote:""});
  const fileRef = useRef();

  const buildParts = (marca, items) => {
    const out = [];
    items.forEach(item => {
      if (isBarrier(marca) && item.codigo_producto?.startsWith("MON-P")) return;
      let serials = item.numeros_serie?.length>0 ? item.numeros_serie
        : item.numero_lote ? Array.from({length:item.cantidad},(_,i)=>`${item.numero_lote}-${String(i+1).padStart(3,"0")}`)
        : ["SIN-SERIAL"];
      if (isBarrier(marca)) serials = serials.filter(sn=>!sn.startsWith("BT"));
      serials.forEach(sn => out.push({
        id:makeId(), marca, codigo:item.codigo_producto, descripcion:item.descripcion,
        serial:sn, qr_data:`COD:${item.codigo_producto}|SN:${sn}`,
        status:"en_stock", fecha_entrada:now(), fecha_salida:null
      }));
    });
    return out;
  };

  const commitEntry = async (marca, items) => {
    const parts = buildParts(marca, items);
    if (!parts.length) { showToast("Sin productos válidos","error"); return null; }
    if (isBarrier(marca)) {
      await addToStaging(parts);
      await logMovement({tipo:"entrada_barrier",fecha:now(),marca,items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length,nota:"Partes Barrier → staging para kits"});
      showToast(`✓ ${parts.length} partes Barrier en staging`);
      setTimeout(()=>setTab(3),1200);
      return null;
    }
    await Promise.all(parts.map(p => addProduct(p)));
    await logMovement({tipo:"entrada",fecha:now(),marca,items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length});
    showToast(`✓ ${parts.length} unidades registradas`);
    return parts;
  };

  const parseImage = async (imgData) => {
    setParsing(true); setParsed(null);
    try {
      const base64 = imgData.split(",")[1];
      const mediaType = imgData.split(";")[0].split(":")[1];
      const text = await callClaude([{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:mediaType,data:base64}},
        {type:"text",text:`Analiza esta delivery note y extrae en JSON (sin markdown):
{"marca":"fabricante o null","items":[{"codigo_producto":"part number exacto","descripcion":"descripción del producto","cantidad":N,"numeros_serie":[],"numero_lote":"lote o null"}]}
REGLAS: seriales SN:A065|A070→["A065","A070"]. Sin seriales→numero_lote. Para BarrierTechnologies: omite seriales BT... y códigos MON-P. Solo JSON.`}
      ]}]);
      setParsed(JSON.parse(text.replace(/```json|```/g,"").trim()));
    } catch { showToast("Error al procesar imagen","error"); }
    setParsing(false);
  };

  const confirmParsed = async () => {
    const parts = await commitEntry(parsed.marca, parsed.items||[]);
    if (parts) setPrintQueue(parts);
    setParsed(null); setImageData(null); setMode(null);
  };

  const confirmManual = async () => {
    const serials = form.seriales ? form.seriales.split(",").map(s=>s.trim()).filter(Boolean) : ["SIN-SERIAL"];
    const items = [{codigo_producto:form.codigo,descripcion:form.descripcion,cantidad:serials.length,numeros_serie:serials,numero_lote:form.lote||null}];
    const parts = await commitEntry(form.marca, items);
    if (parts) setPrintQueue(parts);
    setForm({marca:"",codigo:"",descripcion:"",seriales:"",lote:""}); setMode(null);
  };

  const confirmImport = async () => {
    try {
      const d = JSON.parse(importText.replace(/```json|```/g,"").trim());
      const items = d.products ? d.products.map(p=>({codigo_producto:p.codigo,descripcion:p.descripcion,cantidad:1,numeros_serie:[p.serial],numero_lote:null})) : d.items;
      const parts = await commitEntry(d.marca||"", items);
      if (parts) setPrintQueue(parts);
      setImportText(""); setMode(null);
    } catch { showToast("JSON inválido","error"); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {showCamera && <PhotoCapture onCapture={img=>{setImageData(img);setMode("photo");setShowCamera(false);parseImage(img);}} onClose={()=>setShowCamera(false)}/>}
      <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Registrar Entrada</h2>
        <p style={{margin:0,color:"#64748b",fontSize:14}}>Foto de delivery note, JSON de Claude, o captura manual</p></div>
      {!mode && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {[{icon:"📷",title:"Foto",desc:"Toma foto con la cámara",k:"cam"},{icon:"📋",title:"Importar JSON",desc:"Pega el código de Claude",k:"import"},{icon:"✏️",title:"Manual",desc:"Ingresa los datos",k:"manual"}].map(o=>(
            <Card key={o.k} style={{textAlign:"center",cursor:"pointer"}}>
              <button onClick={()=>o.k==="cam"?setShowCamera(true):setMode(o.k)} style={{background:"none",border:"none",cursor:"pointer",width:"100%",padding:14}}>
                <div style={{fontSize:32,marginBottom:8}}>{o.icon}</div>
                <div style={{fontWeight:700,fontSize:13}}>{o.title}</div>
                <div style={{color:"#94a3b8",fontSize:11,marginTop:3}}>{o.desc}</div>
              </button>
            </Card>
          ))}
        </div>
      )}
      {mode==="photo" && imageData && (
        <Card>
          <Btn variant="outline" small onClick={()=>{setMode(null);setImageData(null);setParsed(null);}} style={{marginBottom:12}}>← Volver</Btn>
          <img src={imageData} alt="dn" style={{width:"100%",borderRadius:8,marginBottom:12,maxHeight:260,objectFit:"contain",background:"#f8fafc"}}/>
          {parsing && <div style={{color:"#64748b",fontSize:13}}>⏳ Analizando con IA...</div>}
          {parsed && (
            <div>
              <div style={{fontWeight:700,color:"#16a34a",marginBottom:8}}>✓ Datos extraídos — confirma</div>
              {parsed.marca?<Badge color="#000" text="#fff">{parsed.marca}</Badge>:<Badge color="#fee2e2" text="#dc2626">Marca no detectada</Badge>}
              {isBarrier(parsed.marca)&&<div style={{marginTop:8,background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#854d0e"}}>🧩 Partes Barrier → staging para kits</div>}
              <div style={{marginTop:10}}>
                {parsed.items?.map((item,i)=>(
                  <Card key={i} style={{marginBottom:8,background:"#f8fafc"}}>
                    <div style={{fontWeight:700}}>{item.codigo_producto}</div>
                    <div style={{color:"#64748b",fontSize:12,marginBottom:6}}>{item.descripcion}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <Badge>{item.cantidad} uds</Badge>
                      {item.numeros_serie?.map(sn=><Badge key={sn} color="#f0fdf4" text="#15803d">SN:{sn}</Badge>)}
                      {item.numero_lote&&<Badge color="#fef9c3" text="#854d0e">Lote:{item.numero_lote}</Badge>}
                    </div>
                  </Card>
                ))}
              </div>
              <div style={{display:"flex",gap:10,marginTop:12}}>
                <Btn onClick={confirmParsed}>✓ Confirmar</Btn>
                <Btn variant="secondary" onClick={()=>{setParsed(null);setImageData(null);setMode(null);}}>Repetir</Btn>
              </div>
            </div>
          )}
        </Card>
      )}
      {mode==="import" && (
        <Card>
          <Btn variant="outline" small onClick={()=>setMode(null)} style={{marginBottom:12}}>← Volver</Btn>
          <div style={{fontWeight:600,fontSize:14,marginBottom:6}}>Pega el JSON generado por Claude</div>
          <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder='{"marca":"Fehling","items":[...]}' style={{width:"100%",minHeight:140,border:"1.5px solid #e2e8f0",borderRadius:8,padding:12,fontSize:13,fontFamily:"monospace",resize:"vertical",boxSizing:"border-box",background:"#fafafa"}}/>
          <Btn onClick={confirmImport} disabled={!importText.trim()} style={{marginTop:10}}>📥 Importar</Btn>
        </Card>
      )}
      {mode==="manual" && (
        <Card>
          <Btn variant="outline" small onClick={()=>setMode(null)} style={{marginBottom:12}}>← Volver</Btn>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Input label="Marca" value={form.marca} onChange={e=>setForm(f=>({...f,marca:e.target.value}))} placeholder="Fehling, Sutter..."/>
              <Input label="Código de Producto" value={form.codigo} onChange={e=>setForm(f=>({...f,codigo:e.target.value}))} placeholder="MHD-7..."/>
            </div>
            {isBarrier(form.marca)&&<div style={{background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#854d0e"}}>🧩 Partes Barrier → staging para kits</div>}
            <Input label="Descripción" value={form.descripcion} onChange={e=>setForm(f=>({...f,descripcion:e.target.value}))}/>
            <Input label="Números de Serie (separados por coma)" value={form.seriales} onChange={e=>setForm(f=>({...f,seriales:e.target.value}))} placeholder="A065, A070"/>
            <Input label="Número de Lote (si no hay seriales)" value={form.lote} onChange={e=>setForm(f=>({...f,lote:e.target.value}))} placeholder="26029955"/>
            <Btn onClick={confirmManual} disabled={!form.marca||!form.codigo}>✓ Registrar</Btn>
          </div>
        </Card>
      )}
      <Modal open={!!printQueue} onClose={()=>setPrintQueue(null)} title="🏷️ Etiquetas listas">
        <div style={{color:"#64748b",fontSize:13,marginBottom:14}}>Formato 50×30mm — código, serial y QR</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
          {printQueue?.map((p,i)=>(
            <div key={i} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:10,display:"flex",alignItems:"center",gap:8}}>
              <QRCanvas text={p.qr_data} size={52}/>
              <div style={{overflow:"hidden"}}>
                <div style={{fontWeight:700,fontSize:11,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.codigo}</div>
                <div style={{fontSize:10,color:"#64748b",fontFamily:"monospace"}}>SN:{p.serial}</div>
              </div>
            </div>
          ))}
        </div>
        {printQueue && <PrintButton items={printQueue} style={{marginTop:14}}/>}
      </Modal>
    </div>
  );
}

// ─── SALIDA TAB ───────────────────────────────────────────────────────────────
function SalidaTab({ ctx }) {
  const { data, updateProduct, updateKit, logMovement, showToast } = ctx;
  const [input, setInput] = useState("");
  const [found, setFound] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [lastSold, setLastSold] = useState(null);
  const [scanning, setScanning] = useState(false);

  const doSearch = (val) => {
    setInput(val); setNotFound(false); setFound(null); setConfirmed(false);
    if (!val.trim()) return;
    if (val.startsWith("KIT:")) {
      const kit = (data.kits||[]).find(k=>k.qr_data===val&&k.status==="en_stock");
      kit ? setFound({...kit,isKit:true}) : setNotFound(true);
      return;
    }
    if (!val.includes("COD:")||!val.includes("SN:")) { if(val.length>3) setNotFound(true); return; }
    const codigo = val.match(/COD:([^|]+)/)?.[1]?.trim();
    const serial = val.match(/SN:(.+)/)?.[1]?.trim();
    if (!codigo||!serial) { setNotFound(true); return; }
    const p = (data.products||[]).find(p=>p.status==="en_stock"&&p.codigo===codigo&&p.serial===serial);
    p ? setFound(p) : setNotFound(true);
  };

  const confirmSale = async () => {
    if (!found) return;
    const ts = now();
    if (found.isKit) {
      await updateKit(found.id,{status:"vendido",fecha_salida:ts});
      await logMovement({tipo:"salida",fecha:ts,marca:"BarrierTechnologies",items:found.parts?.map(p=>({codigo:p.codigo,serial:p.serial}))||[],total:found.parts?.length||0,nota:`Kit: ${found.name}`});
    } else {
      await updateProduct(found.id,{status:"vendido",fecha_salida:ts});
      await logMovement({tipo:"salida",fecha:ts,marca:found.marca,items:[{codigo:found.codigo,serial:found.serial}],total:1});
    }
    setLastSold(found); setConfirmed(true);
    showToast(`✓ Salida: ${found.isKit?found.name:found.codigo}`);
  };

  const reset = () => { setInput(""); setFound(null); setNotFound(false); setConfirmed(false); setLastSold(null); };

  return (
    <>
      {scanning && <QRScanner onScan={v=>{setScanning(false);doSearch(v);}} onClose={()=>setScanning(false)}/>}
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Registrar Salida</h2>
          <p style={{margin:0,color:"#64748b",fontSize:14}}>Escanea el QR del producto con la cámara</p></div>
        <Card>
          <button onClick={()=>{reset();setScanning(true);}} style={{width:"100%",padding:"18px 16px",border:"2px solid #000",borderRadius:0,background:"#000",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,fontFamily:"inherit",marginBottom:14}}>
            <span style={{fontSize:34}}>📷</span>
            <span style={{fontWeight:600,fontSize:14,color:"#fff",letterSpacing:1}}>ESCANEAR QR</span>
            <span style={{fontSize:11,color:"#999"}}>Toca para abrir el escáner</span>
          </button>
          <div style={{borderTop:"1px solid #f1f5f9",paddingTop:12}}>
            <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>O ingresa manualmente</div>
            <Input value={input} onChange={e=>doSearch(e.target.value)} placeholder="COD:MHD-7|SN:A065"/>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>Formato: COD:xxx|SN:yyy — el serial solo no es válido</div>
          </div>
        </Card>
        {found&&!confirmed&&(
          <Card style={{background:"#f0fdf4",border:"1.5px solid #86efac"}}>
            <div style={{fontWeight:700,color:"#16a34a",marginBottom:10}}>{found.isKit?"🧩 Kit identificado":"✓ Producto identificado"}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:14}}>
              <div><span style={{color:"#64748b"}}>Marca:</span> <strong>{found.marca}</strong></div>
              <div><span style={{color:"#64748b"}}>{found.isKit?"Nombre:":"Código:"}</span> <strong>{found.isKit?found.name:found.codigo}</strong></div>
              {found.isKit?(<div style={{gridColumn:"1/-1"}}><span style={{color:"#64748b"}}>Partes:</span> {found.parts?.map(p=><span key={p.id} style={{fontSize:12,background:"#f1f5f9",borderRadius:4,padding:"1px 6px",marginRight:4,fontFamily:"monospace"}}>{p.serial}</span>)}</div>):(
                <><div style={{gridColumn:"1/-1"}}><span style={{color:"#64748b"}}>Descripción:</span> {found.descripcion}</div>
                <div><span style={{color:"#64748b"}}>Serial:</span> <strong style={{fontFamily:"monospace"}}>{found.serial}</strong></div>
                <div><span style={{color:"#64748b"}}>Entrada:</span> {new Date(found.fecha_entrada).toLocaleDateString("es-MX")}</div></>
              )}
            </div>
            <div style={{display:"flex",gap:10,marginTop:14}}>
              <Btn onClick={confirmSale}>📤 Confirmar salida</Btn>
              <Btn variant="secondary" onClick={reset}>Cancelar</Btn>
            </div>
          </Card>
        )}
        {confirmed&&lastSold&&(
          <Card style={{background:"#f8fafc",border:"1.5px solid #000",textAlign:"center",padding:28}}>
            <div style={{fontSize:38,marginBottom:10}}>✅</div>
            <div style={{fontWeight:700,fontSize:16}}>Salida registrada</div>
            <div style={{color:"#475569",fontSize:13,marginTop:4}}>{lastSold.isKit?lastSold.name:`${lastSold.codigo} · SN:${lastSold.serial}`}</div>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:14}}>
              <Btn onClick={()=>{reset();setScanning(true);}}>📷 Escanear otro</Btn>
              <Btn variant="outline" onClick={reset}>Listo</Btn>
            </div>
          </Card>
        )}
        {notFound&&(
          <Card style={{background:"#fef2f2",border:"1.5px solid #fca5a5"}}>
            <div style={{fontWeight:600,color:"#dc2626",marginBottom:6}}>⚠ No encontrado</div>
            <div style={{color:"#64748b",fontSize:13}}>El QR no corresponde a ningún producto en stock.</div>
          </Card>
        )}
      </div>
    </>
  );
}

// ─── INVENTARIO TAB ───────────────────────────────────────────────────────────
function InventarioTab({ ctx }) {
  const { data, updateProduct, showToast } = ctx;
  const [filter, setFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("en_stock");
  const [qrModal, setQrModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editValue, setEditValue] = useState("");

  const products = data.products||[];
  const kits = (data.kits||[]).filter(k=>!isBarrier(k.marca)||k.status==="en_stock");
  const brands = ["all",...new Set(products.map(p=>p.marca).filter(Boolean))];
  const knownBrands = [...new Set(products.map(p=>p.marca).filter(Boolean))].sort();

  const filtered = products.filter(p=>
    (brandFilter==="all"||p.marca===brandFilter)&&
    (statusFilter==="all"||p.status===statusFilter)&&
    (!filter||[p.codigo,p.serial,p.descripcion,p.marca].some(v=>v?.toLowerCase().includes(filter.toLowerCase())))
  );

  const stats = {
    total: products.length+(data.kits||[]).length,
    en_stock: products.filter(p=>p.status==="en_stock").length+(data.kits||[]).filter(k=>k.status==="en_stock").length,
    vendido: products.filter(p=>p.status==="vendido").length+(data.kits||[]).filter(k=>k.status==="vendido").length,
  };

  const confirmEdit = async () => {
    const marca = editValue.trim(); if(!marca) return;
    if (editModal.mode==="single") await updateProduct(editModal.product.id,{marca});
    if (editModal.mode==="bulk") {
      const ids = products.filter(p=>p.codigo===editModal.codigo).map(p=>p.id);
      await Promise.all(ids.map(id=>updateProduct(id,{marca})));
    }
    showToast(`✓ Marca → "${marca}"`);
    setEditModal(null); setEditValue("");
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <h2 style={{margin:0,fontSize:20,fontWeight:700}}>Inventario</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        {[{label:"Total",value:stats.total,color:"#000",text:"#fff"},{label:"En stock",value:stats.en_stock,color:"#dcfce7",text:"#16a34a"},{label:"Vendidos",value:stats.vendido,color:"#fef9c3",text:"#854d0e"}].map((s,i)=>(
          <Card key={i} style={{textAlign:"center",background:s.color,padding:"14px 10px"}}>
            <div style={{fontSize:28,fontWeight:800,color:s.text}}>{s.value}</div>
            <div style={{fontSize:11,color:s.text,opacity:.75}}>{s.label}</div>
          </Card>
        ))}
      </div>
      {(data.kits||[]).filter(k=>k.status==="en_stock").length>0&&(
        <Card style={{background:"#f0fdf4",border:"1.5px solid #86efac"}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🧩 Kits Barrier en stock ({(data.kits||[]).filter(k=>k.status==="en_stock").length})</div>
          {(data.kits||[]).filter(k=>k.status==="en_stock").map(k=>(
            <div key={k.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"8px 0",borderBottom:"1px solid #bbf7d0"}}>
              <QRCanvas text={k.qr_data} size={44}/>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{k.name}</div>
                <div style={{fontSize:11,color:"#64748b"}}>{k.parts?.map(p=>p.serial).join(" · ")}</div></div>
              <PrintButton small items={[{...k,isKit:true}]}/>
            </div>
          ))}
        </Card>
      )}
      <Card>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Input placeholder="Buscar código, serial, descripción..." value={filter} onChange={e=>setFilter(e.target.value)} style={{flex:1,minWidth:160}}/>
          <select value={brandFilter} onChange={e=>setBrandFilter(e.target.value)} style={{border:"1.5px solid #e2e8f0",borderRadius:8,padding:"8px 10px",fontFamily:"inherit",fontSize:13}}>
            {brands.map(b=><option key={b} value={b}>{b==="all"?"Todas las marcas":b}</option>)}
          </select>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{border:"1.5px solid #e2e8f0",borderRadius:8,padding:"8px 10px",fontFamily:"inherit",fontSize:13}}>
            <option value="all">Todos</option><option value="en_stock">En stock</option><option value="vendido">Vendidos</option>
          </select>
        </div>
      </Card>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
              {["Marca","Código","Descripción","Serial","Estado","Entrada","Acciones"].map(h=>(
                <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:600,color:"#64748b",fontSize:11,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.length===0&&<tr><td colSpan={7} style={{padding:28,textAlign:"center",color:"#94a3b8"}}>Sin resultados</td></tr>}
              {filtered.map((p,i)=>(
                <tr key={p.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2===0?"#fff":"#fafafa"}}>
                  <td style={{padding:"9px 12px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      {p.marca?<Badge color="#000" text="#fff">{p.marca}</Badge>:<Badge color="#fee2e2" text="#dc2626">Sin marca</Badge>}
                      <button onClick={()=>{setEditModal({mode:"single",product:p});setEditValue(p.marca||"");}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,opacity:.5,padding:1}}>✏️</button>
                    </div>
                  </td>
                  <td style={{padding:"9px 12px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontWeight:700}}>{p.codigo}</span>
                      <button onClick={()=>{setEditModal({mode:"bulk",codigo:p.codigo});setEditValue(p.marca||"");}} title="Editar todas" style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#94a3b8",padding:1}}>↕</button>
                    </div>
                  </td>
                  <td style={{padding:"9px 12px",color:"#475569",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.descripcion}>{p.descripcion}</td>
                  <td style={{padding:"9px 12px",fontFamily:"monospace",fontSize:11}}>{p.serial}</td>
                  <td style={{padding:"9px 12px"}}><Badge color={p.status==="en_stock"?"#dcfce7":"#fef9c3"} text={p.status==="en_stock"?"#16a34a":"#854d0e"}>{p.status==="en_stock"?"En stock":"Vendido"}</Badge></td>
                  <td style={{padding:"9px 12px",color:"#64748b",fontSize:11,whiteSpace:"nowrap"}}>{new Date(p.fecha_entrada).toLocaleDateString("es-MX")}</td>
                  <td style={{padding:"9px 12px"}}><Btn small variant="outline" onClick={()=>setQrModal(p)}>Ver QR</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={!!qrModal} onClose={()=>setQrModal(null)} title="Vista previa de etiqueta">
        {qrModal&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
            <div style={{width:280,height:168,border:"1.5px solid #000",display:"flex",borderRadius:4,overflow:"hidden",boxShadow:"0 4px 16px rgba(0,0,0,.12)"}}>
              <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",padding:"10px 10px 10px 14px",borderRight:"1px solid #000"}}>
                <div style={{fontSize:8,color:"#999",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>MKJ TRADE</div>
                <div style={{fontSize:16,fontWeight:800,color:"#000",lineHeight:1.2,wordBreak:"break-all"}}>{qrModal.codigo}</div>
                <div style={{fontSize:12,color:"#333",fontFamily:"monospace",marginTop:6,wordBreak:"break-all"}}>SN: {qrModal.serial}</div>
              </div>
              <div style={{width:140,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:8}}>
                <QRCanvas text={qrModal.qr_data} size={112}/>
              </div>
            </div>
            <div style={{color:"#94a3b8",fontSize:11,fontFamily:"monospace"}}>{qrModal.qr_data}</div>
            <PrintButton items={[qrModal]}/>
          </div>
        )}
      </Modal>
      <Modal open={!!editModal} onClose={()=>{setEditModal(null);setEditValue("");}} title="Editar marca">
        {editModal&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Input label="Nueva marca" value={editValue} onChange={e=>setEditValue(e.target.value)} placeholder="Autotissue, Fehling, Sutter..."/>
            {knownBrands.length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {knownBrands.map(b=><button key={b} onClick={()=>setEditValue(b)} style={{background:editValue===b?"#000":"#f1f5f9",color:editValue===b?"#fff":"#0f172a",border:"none",borderRadius:6,padding:"4px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>{b}</button>)}
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={confirmEdit} disabled={!editValue.trim()}>✓ Guardar</Btn>
              <Btn variant="secondary" onClick={()=>{setEditModal(null);setEditValue("");}}>Cancelar</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── KITS TAB ─────────────────────────────────────────────────────────────────
function KitsTab({ ctx }) {
  const { data, addKit, removeFromStaging, logMovement, showToast } = ctx;
  const [selected, setSelected] = useState([]);
  const [kitName, setKitName] = useState("");
  const [printKit, setPrintKit] = useState(null);
  const [expandedKit, setExpandedKit] = useState(null);

  const staging = data.staging||[];
  const kits = data.kits||[];
  const toggle = id => setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const partType = s => {
    if(!s) return {label:"Accesorio",icon:"📦",color:"#f1f5f9",text:"#475569"};
    if(s.startsWith("A")) return {label:"Mandil",icon:"🥼",color:"#dbeafe",text:"#1d4ed8"};
    if(s.startsWith("T")) return {label:"Tiroideo",icon:"🛡️",color:"#f0fdf4",text:"#16a34a"};
    return {label:"Accesorio",icon:"📦",color:"#fef9c3",text:"#854d0e"};
  };

  const createKit = async () => {
    if(!selected.length){showToast("Selecciona al menos una parte","error");return;}
    const kitId = makeId();
    const parts = staging.filter(p=>selected.includes(p.id));
    const name = kitName.trim()||`Kit Barrier ${kits.length+1}`;
    const newKit = {id:kitId,name,marca:"BarrierTechnologies",partIds:selected,parts:parts.map(p=>({id:p.id,codigo:p.codigo,serial:p.serial,descripcion:p.descripcion})),qr_data:`KIT:${kitId}`,status:"en_stock",fecha_creacion:now(),fecha_salida:null};
    await removeFromStaging(selected);
    await addKit(newKit);
    await logMovement({tipo:"kit_creado",fecha:now(),marca:"BarrierTechnologies",items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length,nota:`Kit: ${name}`});
    setSelected([]); setKitName(""); setPrintKit(newKit);
    showToast(`✓ Kit "${name}" creado`);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Kits — Barrier Technologies</h2>
        <p style={{margin:0,color:"#64748b",fontSize:14}}>Asocia partes para formar kits con QR único</p></div>
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:15}}>🗂️ Partes en staging ({staging.length})</div>
          {staging.length>0&&<div style={{display:"flex",gap:6}}>
            <Btn small variant="secondary" onClick={()=>setSelected(staging.map(p=>p.id))}>Selec. todo</Btn>
            {selected.length>0&&<Btn small variant="outline" onClick={()=>setSelected([])}>Limpiar</Btn>}
          </div>}
        </div>
        {staging.length===0?(
          <div style={{textAlign:"center",padding:"28px 0",color:"#94a3b8"}}>
            <div style={{fontSize:36,marginBottom:8}}>📭</div>
            <div>No hay partes en staging</div>
            <div style={{fontSize:12,marginTop:4}}>Registra una entrada de Barrier para comenzar</div>
          </div>
        ):(
          <>
            {[{prefix:"A",label:"🥼 Mandiles"},{prefix:"T",label:"🛡️ Tiroides"},{prefix:null,label:"📦 Otros"}].map(group=>{
              const gparts=staging.filter(p=>group.prefix?p.serial?.startsWith(group.prefix):!p.serial?.startsWith("A")&&!p.serial?.startsWith("T"));
              if(!gparts.length) return null;
              return (
                <div key={group.label} style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748b",marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>{group.label} ({gparts.length})</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
                    {gparts.map(p=>{
                      const sel=selected.includes(p.id); const pt=partType(p.serial);
                      return (
                        <button key={p.id} onClick={()=>toggle(p.id)} style={{border:sel?"2px solid #000":"1.5px solid #e2e8f0",background:sel?"#000":pt.color,color:sel?"#fff":pt.text,borderRadius:8,padding:"10px 12px",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .12s"}}>
                          <div style={{fontSize:11,opacity:.7,marginBottom:3}}>{pt.icon} {pt.label}</div>
                          <div style={{fontWeight:700,fontSize:13}}>{p.codigo}</div>
                          <div style={{fontFamily:"monospace",fontSize:11,opacity:.85,marginTop:2}}>SN: {p.serial}</div>
                          <div style={{fontSize:10,opacity:.6,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.descripcion}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{borderTop:"1.5px solid #e2e8f0",paddingTop:14,marginTop:4}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:160}}>
                  <Input label={`Nombre del kit — ${selected.length} partes`} value={kitName} onChange={e=>setKitName(e.target.value)} placeholder={`Kit Barrier ${kits.length+1}`}/>
                </div>
                <Btn onClick={createKit} disabled={!selected.length}>🧩 Crear kit</Btn>
              </div>
              {selected.length>0&&(
                <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:5}}>
                  {staging.filter(p=>selected.includes(p.id)).map(p=>(
                    <span key={p.id} style={{fontSize:11,background:"#000",color:"#fff",borderRadius:5,padding:"2px 8px",fontFamily:"monospace"}}>{partType(p.serial).icon} {p.serial}</span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Card>
      {kits.length>0&&(
        <div>
          <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>Kits ({kits.filter(k=>k.status==="en_stock").length} en stock)</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {kits.map(kit=>(
              <Card key={kit.id} style={{border:kit.status==="en_stock"?"1.5px solid #000":"1px solid #e2e8f0",opacity:kit.status==="vendido"?.6:1}}>
                <div style={{display:"flex",gap:14}}>
                  <div style={{flexShrink:0,cursor:"pointer"}} onClick={()=>setPrintKit(kit)}><QRCanvas text={kit.qr_data} size={68}/></div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:6}}>
                      <span style={{fontWeight:700,fontSize:15}}>{kit.name}</span>
                      <Badge color={kit.status==="en_stock"?"#000":"#fef9c3"} text={kit.status==="en_stock"?"#fff":"#854d0e"}>{kit.status==="en_stock"?"En stock":"Vendido"}</Badge>
                      <span style={{fontSize:11,color:"#94a3b8"}}>{kit.parts.length} partes · {new Date(kit.fecha_creacion).toLocaleDateString("es-MX")}</span>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10,cursor:"pointer"}} onClick={()=>setExpandedKit(expandedKit===kit.id?null:kit.id)}>
                      {kit.parts.map(p=><span key={p.id} style={{fontSize:11,background:"#f1f5f9",borderRadius:5,padding:"2px 8px",fontFamily:"monospace"}}>{partType(p.serial).icon} SN:{p.serial}</span>)}
                    </div>
                    {expandedKit===kit.id&&(
                      <div style={{background:"#f8fafc",borderRadius:8,padding:10,marginBottom:10}}>
                        {kit.parts.map(p=><div key={p.id} style={{fontSize:12,color:"#475569",marginBottom:3}}><strong>{p.codigo}</strong> · SN:{p.serial} · <span style={{color:"#94a3b8"}}>{p.descripcion}</span></div>)}
                      </div>
                    )}
                    <PrintButton small items={[{...kit,isKit:true}]}/>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
      <Modal open={!!printKit} onClose={()=>setPrintKit(null)} title={`QR — ${printKit?.name}`}>
        {printKit&&(
          <div style={{textAlign:"center"}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:8}}><QRCanvas text={printKit.qr_data} size={200}/></div>
            <div style={{fontWeight:700,fontSize:16,marginTop:8}}>{printKit.name}</div>
            <div style={{color:"#64748b",fontSize:11,fontFamily:"monospace",marginTop:4}}>{printKit.qr_data}</div>
            <div style={{marginTop:10,display:"flex",flexWrap:"wrap",justifyContent:"center",gap:5}}>
              {printKit.parts?.map(p=><span key={p.id} style={{fontSize:11,background:"#f1f5f9",borderRadius:5,padding:"2px 8px",fontFamily:"monospace"}}>{partType(p.serial)?.icon} {p.serial}</span>)}
            </div>
            <div style={{marginTop:16}}><PrintButton items={[{...printKit,isKit:true}]}/></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── HISTORIAL TAB ────────────────────────────────────────────────────────────
function HistorialTab({ ctx }) {
  const { data } = ctx;
  const sorted = [...(data.movements||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  const typeLabel = {entrada:"Entrada",salida:"Salida",entrada_barrier:"Entrada Barrier",kit_creado:"Kit creado"};
  const typeColor = {entrada:{bg:"#dcfce7",text:"#16a34a"},salida:{bg:"#fef9c3",text:"#854d0e"},entrada_barrier:{bg:"#dbeafe",text:"#1d4ed8"},kit_creado:{bg:"#f0fdf4",text:"#166534"}};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Historial</h2>
        <p style={{margin:0,color:"#64748b",fontSize:14}}>{sorted.length} movimientos</p></div>
      {sorted.length===0&&<Card style={{textAlign:"center",padding:40,color:"#94a3b8"}}><div style={{fontSize:36,marginBottom:8}}>📋</div>Sin movimientos aún</Card>}
      {sorted.map((m,i)=>{
        const c=typeColor[m.tipo]||{bg:"#f1f5f9",text:"#64748b"};
        return (
          <Card key={i}>
            <div style={{display:"flex",gap:12}}>
              <div style={{width:40,height:40,borderRadius:10,flexShrink:0,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                {m.tipo==="entrada"?"📥":m.tipo==="salida"?"📤":m.tipo==="kit_creado"?"🧩":"🗂️"}
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:4}}>
                  <Badge color={c.bg} text={c.text}>{typeLabel[m.tipo]||m.tipo}</Badge>
                  <Badge color="#000" text="#fff">{m.marca}</Badge>
                  <span style={{fontSize:11,color:"#94a3b8"}}>{new Date(m.fecha).toLocaleString("es-MX")}</span>
                </div>
                {m.nota&&<div style={{fontSize:11,color:"#64748b",fontStyle:"italic",marginBottom:4}}>{m.nota}</div>}
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {m.items?.slice(0,8).map((item,j)=><span key={j} style={{fontSize:10,background:"#f1f5f9",borderRadius:4,padding:"1px 7px",fontFamily:"monospace"}}>{item.codigo}·{item.serial}</span>)}
                  {m.items?.length>8&&<span style={{fontSize:10,color:"#94a3b8"}}>+{m.items.length-8} más</span>}
                </div>
                <div style={{fontSize:11,color:"#64748b",marginTop:4}}>{m.total} unidad{m.total!==1?"es":""}</div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// Helper used in KitsTab modal outside component scope
function partType(s) {
  if(!s) return {label:"Accesorio",icon:"📦"};
  if(s.startsWith("A")) return {label:"Mandil",icon:"🥼"};
  if(s.startsWith("T")) return {label:"Tiroideo",icon:"🛡️"};
  return {label:"Accesorio",icon:"📦"};
}
