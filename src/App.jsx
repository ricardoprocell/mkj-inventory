import { useState, useRef, useEffect, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzYx-dBxo7_oktqUV-Yg6bUR0T1JEDZ0PGrudpMIOgegUxhpy9VS_HCXvDkDsTAJ8A/exec";
const SPREADSHEET_ID  = "1PXEUiwnv1pkKrIxwj69FBRSXwKL3m9z05Dlxt24jhBk";

// ─── GOOGLE SHEETS DB ─────────────────────────────────────────────────────────
const db = {
  async get() {
    try {
      const r = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "getAll" }),
      });
      const d = await r.json();
      return d.ok ? d.data : null;
    } catch {
      return null;
    }
  },
  async post(action, payload = {}) {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action, ...payload }),
    });
    return r.json();
  },
  saveProduct:  (p)     => db.post("saveProduct",  { product: p }),
  updateProduct:(id, f) => db.post("updateProduct",{ id, fields: f }),
  saveKit:      (k)     => db.post("saveKit",      { kit: k }),
  updateKit:    (id, f) => db.post("updateKit",    { id, fields: f }),
  saveStaging:  (ps)    => db.post("saveStaging",  { parts: ps }),
  removeStaging:(ids)   => db.post("removeStaging",{ ids }),
  logMovement:  (m)     => db.post("logMovement",  { movement: m }),
  bulkLoad:     (data)  => db.post("bulkLoad",     { data }),
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const makeId   = () => `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const nowISO   = () => new Date().toISOString();
const isBarrier = m  => m?.toLowerCase().includes("barrier");

// ─── QR LIB (QRCode.js) ───────────────────────────────────────────────────────
const loadQRLib = (() => {
  let p = null;
  return () => p || (p = new Promise(res => {
    if (window.QRCode) return res();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = res;
    document.head.appendChild(s);
  }));
})();

function QRCanvas({ text, size = 120 }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current || !text) return;
    ref.current.innerHTML = "";
    loadQRLib().then(() => {
      try { new window.QRCode(ref.current, { text, width: size, height: size, colorDark: "#000", colorLight: "#fff" }); }
      catch {}
    });
  }, [text, size]);
  return <div ref={ref} style={{ width: size, height: size, display: "inline-block" }} />;
}

const makeQRDataUrl = (text, size = 200) => new Promise(async res => {
  await loadQRLib();
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-9999px;top:-9999px;z-index:-1";
  document.body.appendChild(el);
  try {
    new window.QRCode(el, { text, width: size, height: size, colorDark: "#000", colorLight: "#fff" });
    setTimeout(() => {
      const c = el.querySelector("canvas"), img = el.querySelector("img");
      res(c ? c.toDataURL("image/png") : img?.src || "");
      document.body.removeChild(el);
    }, 150);
  } catch { document.body.removeChild(el); res(""); }
});

// ─── jsQR ─────────────────────────────────────────────────────────────────────
const loadJsQR = (() => {
  let p = null;
  return () => p || (p = new Promise(res => {
    if (window.jsQR) return res(window.jsQR);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js";
    s.onload = () => res(window.jsQR);
    document.head.appendChild(s);
  }));
})();

// ─── CAMERA COMPONENT ─────────────────────────────────────────────────────────
// mode: "photo" | "qr"
// onPhoto(dataUrl)  — called when photo is taken
// onQR(string)      — called when QR code is detected
// onClose()
function Camera({ mode, onPhoto, onQR, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const alive     = useRef(true);
  const rafRef    = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus]   = useState("requesting"); // requesting|live|captured|error
  const [captured, setCaptured] = useState(null);
  const [errMsg, setErrMsg]   = useState("");

  // Pre-load jsQR in background if needed
  useEffect(() => { if (mode === "qr") loadJsQR(); }, [mode]);

  // Start camera on mount
  useEffect(() => {
    alive.current = true;
    startStream();
    return () => {
      alive.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function startStream() {
    setStatus("requesting");
    setErrMsg("");
    const attempts = [
      { video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { facingMode: "environment" } },
      { video: true },
    ];
    let stream = null;
    for (const c of attempts) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
      catch {}
    }
    if (!alive.current) { stream?.getTracks().forEach(t => t.stop()); return; }
    if (!stream) {
      setErrMsg("No se pudo acceder a la cámara.\n\nEn iPhone: Ajustes → Safari → Cámara → Permitir\nEn Android: toca el candado en la barra de dirección");
      setStatus("error");
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    video.srcObject = stream;
    try { await video.play(); } catch {}
    if (!alive.current) return;
    setStatus("live");
    if (mode === "qr") startQRLoop();
  }

  async function startQRLoop() {
    const jsQR = await loadJsQR();
    const tick = () => {
      if (!alive.current) return;
      const v = videoRef.current, c = canvasRef.current;
      if (v && c && v.readyState >= 2 && v.videoWidth > 0) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(v, 0, 0);
        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          alive.current = false;
          streamRef.current?.getTracks().forEach(t => t.stop());
          onQR(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function snap() {
    const v = videoRef.current, c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const dataUrl = c.toDataURL("image/jpeg", 0.92);
    streamRef.current?.getTracks().forEach(t => t.stop());
    setCaptured(dataUrl);
    setStatus("captured");
  }

  function retake() {
    setCaptured(null);
    startStream();
  }

  function confirm() {
    onPhoto(captured);
    onClose();
  }

  function close() {
    alive.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    onClose();
  }

  const title = mode === "qr" ? "ESCANEAR QR" : "FOTO DE DELIVERY NOTE";

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:3000, display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ background:"#000", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #222", flexShrink:0 }}>
        <span style={{ color:"#fff", fontWeight:700, letterSpacing:1, fontSize:14 }}>{title}</span>
        <button onClick={close} style={{ background:"#222", border:"none", color:"#fff", padding:"8px 16px", borderRadius:6, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>✕ Cerrar</button>
      </div>

      {/* Viewfinder */}
      <div style={{ flex:1, position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <video
          ref={videoRef}
          playsInline muted autoPlay
          style={{ width:"100%", height:"100%", objectFit:"cover", display: status==="live"||status==="captured"?"block":"none" }}
        />
        {captured && status==="captured" && (
          <img src={captured} alt="preview" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain" }} />
        )}
        <canvas ref={canvasRef} style={{ display:"none" }} />

        {/* QR reticle */}
        {mode==="qr" && status==="live" && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
            <div style={{ width:220, height:220, position:"relative" }}>
              {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h]) => (
                <div key={v+h} style={{ position:"absolute", width:28, height:28, [v]:0, [h]:0,
                  borderTop: v==="top"?"3px solid #fff":"none", borderBottom: v==="bottom"?"3px solid #fff":"none",
                  borderLeft: h==="left"?"3px solid #fff":"none", borderRight: h==="right"?"3px solid #fff":"none" }} />
              ))}
              <div style={{ position:"absolute", left:6, right:6, height:2, background:"rgba(255,255,255,.8)", animation:"scan 1.8s ease-in-out infinite" }} />
            </div>
          </div>
        )}

        {/* States */}
        {status==="requesting" && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
            <div style={{ width:48, height:48, border:"3px solid #333", borderTop:"3px solid #fff", borderRadius:"50%", animation:"spin 1s linear infinite" }} />
            <div style={{ color:"#fff", fontSize:14 }}>Solicitando acceso a cámara...</div>
          </div>
        )}
        {status==="error" && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, padding:32 }}>
            <div style={{ fontSize:40 }}>📷</div>
            <div style={{ color:"#fca5a5", fontSize:13, textAlign:"center", lineHeight:1.7, whiteSpace:"pre-line" }}>{errMsg}</div>
            <button onClick={startStream} style={{ background:"#fff", color:"#000", border:"none", borderRadius:8, padding:"12px 28px", fontFamily:"inherit", fontWeight:700, fontSize:14, cursor:"pointer" }}>Reintentar</button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ background:"#111", padding:"16px 24px", display:"flex", justifyContent:"center", alignItems:"center", gap:16, flexShrink:0 }}>
        {mode==="photo" && status==="live" && (
          <button onClick={snap} style={{ width:68, height:68, borderRadius:"50%", background:"#fff", border:"4px solid #555", cursor:"pointer", fontSize:28, display:"flex", alignItems:"center", justifyContent:"center" }}>📷</button>
        )}
        {mode==="photo" && status==="captured" && (
          <>
            <button onClick={retake} style={{ background:"#333", border:"none", color:"#fff", padding:"12px 24px", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontWeight:600, fontSize:14 }}>↩ Repetir</button>
            <button onClick={confirm} style={{ background:"#fff", border:"none", color:"#000", padding:"12px 28px", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:14 }}>✓ Usar esta foto</button>
          </>
        )}
        {mode==="qr" && status==="live" && (
          <div style={{ color:"#666", fontSize:12, letterSpacing:1 }}>Apunta al QR del producto</div>
        )}
      </div>
      <style>{`@keyframes scan{0%{top:10%}50%{top:85%}100%{top:10%}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── LABEL PRINT ──────────────────────────────────────────────────────────────
const renderLabel = async (item) => {
  const W = 472, H = 283;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.strokeRect(1,1,W-2,H-2);
  ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W-235,4); ctx.lineTo(W-235,H-4); ctx.stroke();
  const cod = item.isKit ? (item.name||item.codigo) : item.codigo;
  const sn  = item.isKit ? (item.parts||[]).map(p=>p.serial).join("+") : item.serial;
  ctx.fillStyle = "#aaa"; ctx.font = "bold 12px Arial"; ctx.fillText("MKJ TRADE", 14, 22);
  ctx.fillStyle = "#000"; ctx.font = `bold ${cod.length>10?24:30}px Arial`;
  ctx.fillText(cod.slice(0,16)+(cod.length>16?"…":""), 14, 80);
  ctx.fillStyle = "#333"; ctx.font = "19px 'Courier New'";
  ctx.fillText("SN: "+sn.slice(0,20), 14, 116);
  const qrDu = await makeQRDataUrl(item.qr_data, 200);
  const qrImg = new Image();
  await new Promise((res,rej)=>{qrImg.onload=res;qrImg.onerror=rej;qrImg.src=qrDu;});
  ctx.drawImage(qrImg, W-228, 18, 210, 210);
  return canvas.toDataURL("image/png");
};

function PrintButton({ items, small = false }) {
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    setLoading(true);
    const images = await Promise.all(items.map(async item => ({
      dataUrl: await renderLabel(item),
      name: item.isKit ? (item.name||item.codigo) : item.codigo,
      sn: item.isKit ? (item.parts||[]).map(p=>p.serial).join("+") : item.serial,
    })));
    setLoading(false); setModal(images);
  };
  return (
    <>
      <Btn small={small} onClick={generate} disabled={loading}>{loading?"⏳ Generando...":"🖨️ Imprimir etiqueta"}</Btn>
      {modal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setModal(null)}>
          <div style={{background:"#fff",borderRadius:16,padding:22,maxWidth:400,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <h3 style={{margin:0,fontSize:16,fontWeight:700}}>Etiqueta lista — 50×30mm</h3>
              <button onClick={()=>setModal(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94a3b8"}}>✕</button>
            </div>
            <div style={{background:"#f8fafc",borderRadius:10,padding:12,marginBottom:14,fontSize:12,color:"#475569",lineHeight:1.7}}>
              <strong>iPhone:</strong> mantén presionada la imagen → Compartir → NIIMBOT<br/>
              <strong>Mac/PC:</strong> toca "Descargar" e imprime desde ahí
            </div>
            {modal.map((img,i)=>(
              <div key={i} style={{marginBottom:14,textAlign:"center"}}>
                <img src={img.dataUrl} alt={img.name} style={{width:"100%",borderRadius:8,border:"1px solid #e2e8f0"}}/>
                <div style={{marginTop:8}}>
                  <a href={img.dataUrl} download={`${img.name}-${img.sn}.png`} style={{fontSize:13,color:"#000",fontWeight:700,textDecoration:"underline"}}>↓ Descargar imagen</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
const Badge = ({children,color="#e2e8f0",text="#1e293b"}) => (
  <span style={{background:color,color:text,borderRadius:6,padding:"2px 10px",fontSize:12,fontWeight:600}}>{children}</span>
);
const Btn = ({children,onClick,variant="primary",disabled,small,style={}}) => {
  const v = {
    primary:   {background:"#000",color:"#fff",borderRadius:0,letterSpacing:.5},
    secondary: {background:"#f1f5f9",color:"#0f172a",borderRadius:6},
    success:   {background:"#dcfce7",color:"#16a34a",borderRadius:6},
    outline:   {background:"transparent",color:"#000",border:"1.5px solid #000",borderRadius:0},
    danger:    {background:"#fee2e2",color:"#dc2626",borderRadius:6},
  };
  return <button style={{border:"none",cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:600,opacity:disabled?.45:1,display:"inline-flex",alignItems:"center",gap:6,padding:small?"6px 14px":"10px 20px",fontSize:small?13:14,...v[variant],...style}} onClick={onClick} disabled={disabled}>{children}</button>;
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

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude(base64, mediaType) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-api-key": "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model:"claude-sonnet-4-6",
      max_tokens:1500,
      system:"Extrae datos de documentos logísticos. Responde solo JSON válido sin markdown.",
      messages:[{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:mediaType,data:base64}},
        {type:"text",text:`Analiza esta delivery note y extrae en JSON:
{"marca":"fabricante o null","items":[{"codigo_producto":"part number exacto","descripcion":"descripción del producto","cantidad":N,"numeros_serie":["SN1","SN2"],"numero_lote":"lote o null"}]}
REGLAS:
- codigo_producto: el part number exacto del fabricante (ej: MHD-7, BSM-7, 780198SGS)
- Si hay seriales tipo SN:A065|A070 → numeros_serie:["A065","A070"]
- Si hay Lot number sin seriales individuales → numero_lote con el número, numeros_serie:[]
- Accesorios sin serial ni lote → numeros_serie:[], numero_lote:null
- Barrier Technologies: omite items con código MON-P y seriales que empiecen con BT
- Responde SOLO el JSON, sin explicaciones ni markdown`}
      ]}]
    })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "API error");
  return d.content?.find(b=>b.type==="text")?.text || "";
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = ["📥 Entrada","📤 Salida","📦 Inventario","🧩 Kits","📊 Historial"];

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState({products:[],kits:[],staging:[],movements:[]});
  const [loading, setLoading] = useState(true);
  const [sheetsOK, setSheetsOK] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg,type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  useEffect(() => {
    setLoading(false); // show app immediately
    let cancelled = false;
    const trySheets = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const timeout = new Promise((_, rej) => setTimeout(()=>rej(new Error("timeout")), 10000));
          const d = await Promise.race([db.get(), timeout]);
          if (cancelled) return;
          if (d) { setData(d); setSheetsOK(true); return; }
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
        }
      }
    };
    trySheets();
    return () => { cancelled = true; };
  }, []);

  // Optimistic state updaters
  const mut = {
    addProduct:     p     => { setData(d=>({...d,products:[...d.products,p]}));                                        db.saveProduct(p); },
    updateProduct:  (id,f)=> { setData(d=>({...d,products:d.products.map(p=>p.id===id?{...p,...f}:p)}));               db.updateProduct(id,f); },
    addKit:         k     => { setData(d=>({...d,kits:[...d.kits,k]}));                                                db.saveKit(k); },
    updateKit:      (id,f)=> { setData(d=>({...d,kits:d.kits.map(k=>k.id===id?{...k,...f}:k)}));                       db.updateKit(id,f); },
    addStaging:     ps    => { setData(d=>({...d,staging:[...d.staging,...ps]}));                                      db.saveStaging(ps); },
    removeStaging:  ids   => { setData(d=>({...d,staging:d.staging.filter(p=>!ids.includes(p.id))}));                  db.removeStaging(ids); },
    logMovement:    m     => { setData(d=>({...d,movements:[...d.movements,m]}));                                      db.logMovement(m); },
  };

  const staging = data.staging?.length||0;
  const inStock = (data.products||[]).filter(p=>p.status==="en_stock").length + (data.kits||[]).filter(k=>k.status==="en_stock").length;
  const ctx = {data, mut, showToast, setTab};

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#000",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
      <svg width="72" height="72" viewBox="0 0 52 52" fill="none">
        <circle cx="26" cy="26" r="23" stroke="#fff" strokeWidth="2" fill="none"/>
        <text x="7" y="34" fontFamily="Arial" fontWeight="700" fontSize="17" fill="#fff">MKJ</text>
      </svg>
      <div style={{color:"#555",fontSize:12,letterSpacing:3}}>CARGANDO...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f5f5f5",fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      <div style={{background:"#000",color:"#fff",padding:"14px 20px",display:"flex",alignItems:"center",gap:14}}>
        <svg width="46" height="46" viewBox="0 0 52 52" fill="none">
          <circle cx="26" cy="26" r="23" stroke="#fff" strokeWidth="2" fill="none"/>
          <text x="8" y="33" fontFamily="Arial" fontWeight="700" fontSize="16" fill="#fff">M</text>
          <text x="20" y="33" fontFamily="Arial" fontWeight="700" fontSize="16" fill="#fff">K</text>
          <text x="32" y="33" fontFamily="Arial" fontWeight="700" fontSize="16" fill="#fff">J</text>
        </svg>
        <div style={{borderLeft:"1px solid #333",paddingLeft:14}}>
          <div style={{fontWeight:300,fontSize:17,letterSpacing:6}}>TRADE</div>
          <div style={{fontSize:9,letterSpacing:2,marginTop:1,color:sheetsOK?"#4ade80":"#f59e0b"}}>
            {sheetsOK?"● GOOGLE SHEETS":"● CONECTANDO..."}
          </div>
        </div>
        <div style={{marginLeft:"auto",textAlign:"right"}}>
          <div style={{fontSize:22,fontWeight:700}}>{inStock}</div>
          <div style={{fontSize:9,color:"#666",letterSpacing:1}}>EN STOCK</div>
        </div>
      </div>
      <div style={{background:"#fff",borderBottom:"1.5px solid #e5e5e5",display:"flex",overflowX:"auto",padding:"0 16px"}}>
        {TABS.map((t,i)=>(
          <button key={i} onClick={()=>setTab(i)} style={{position:"relative",border:"none",background:"none",padding:"13px 14px",cursor:"pointer",fontWeight:tab===i?700:400,color:tab===i?"#000":"#999",borderBottom:tab===i?"2.5px solid #000":"2.5px solid transparent",fontSize:12,fontFamily:"inherit",whiteSpace:"nowrap",letterSpacing:.3}}>
            {t}
            {i===3&&staging>0&&<span style={{position:"absolute",top:8,right:2,background:"#dc2626",color:"#fff",borderRadius:10,fontSize:9,padding:"1px 5px",fontWeight:700}}>{staging}</span>}
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
      {toast&&<div style={{position:"fixed",bottom:20,right:20,background:toast.type==="success"?"#000":"#dc2626",color:"#fff",padding:"11px 18px",fontSize:13,fontWeight:500,boxShadow:"0 4px 20px rgba(0,0,0,.3)",zIndex:4000,borderLeft:"3px solid #fff",maxWidth:320}}>{toast.msg}</div>}
    </div>
  );
}

// ─── ENTRADA TAB ──────────────────────────────────────────────────────────────
function EntradaTab({ctx}) {
  const {mut,showToast,setTab} = ctx;
  const [mode, setMode] = useState(null);
  const [camera, setCamera] = useState(false);
  const [imageData, setImageData] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [printQueue, setPrintQueue] = useState(null);
  const [importText, setImportText] = useState("");
  const [form, setForm] = useState({marca:"",codigo:"",descripcion:"",seriales:"",lote:""});
  const fileRef = useRef();

  const buildParts = (marca, items) => {
    const out = [];
    (items||[]).forEach(item => {
      if (isBarrier(marca) && item.codigo_producto?.startsWith("MON-P")) return;
      let sns = item.numeros_serie?.length>0 ? item.numeros_serie
        : item.numero_lote ? Array.from({length:item.cantidad||1},(_,i)=>`${item.numero_lote}-${String(i+1).padStart(3,"0")}`)
        : ["SIN-SERIAL"];
      if (isBarrier(marca)) sns = sns.filter(s=>!s.startsWith("BT"));
      sns.forEach(sn => out.push({id:makeId(),marca,codigo:item.codigo_producto,descripcion:item.descripcion,serial:sn,qr_data:`COD:${item.codigo_producto}|SN:${sn}`,status:"en_stock",fecha_entrada:nowISO(),fecha_salida:null}));
    });
    return out;
  };

  const commit = async (marca, items) => {
    const parts = buildParts(marca, items);
    if (!parts.length) { showToast("Sin productos válidos","error"); return null; }
    if (isBarrier(marca)) {
      mut.addStaging(parts);
      mut.logMovement({tipo:"entrada_barrier",fecha:nowISO(),marca,items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length,nota:"Partes Barrier → staging"});
      showToast(`✓ ${parts.length} partes Barrier en staging`);
      setTimeout(()=>setTab(3),1200);
      return null;
    }
    parts.forEach(p => mut.addProduct(p));
    mut.logMovement({tipo:"entrada",fecha:nowISO(),marca,items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length});
    showToast(`✓ ${parts.length} unidades registradas`);
    return parts;
  };

  const parsePhoto = async (img) => {
    setParsing(true); setParsed(null); setMode("photo");
    try {
      const base64 = img.split(",")[1];
      const mediaType = img.split(";")[0].split(":")[1];
      const text = await callClaude(base64, mediaType);
      setParsed(JSON.parse(text.replace(/```json|```/g,"").trim()));
    } catch { showToast("Error al procesar imagen","error"); }
    setParsing(false);
  };

  const confirmParsed = async () => {
    const parts = await commit(parsed.marca, parsed.items);
    if (parts) setPrintQueue(parts);
    setParsed(null); setImageData(null); setMode(null);
  };

  const confirmManual = async () => {
    const sns = form.seriales ? form.seriales.split(",").map(s=>s.trim()).filter(Boolean) : ["SIN-SERIAL"];
    const parts = await commit(form.marca, [{codigo_producto:form.codigo,descripcion:form.descripcion,cantidad:sns.length,numeros_serie:sns,numero_lote:form.lote||null}]);
    if (parts) setPrintQueue(parts);
    setForm({marca:"",codigo:"",descripcion:"",seriales:"",lote:""}); setMode(null);
  };

  const confirmImport = async () => {
    try {
      const d = JSON.parse(importText.replace(/```json|```/g,"").trim());
      const items = d.products ? d.products.map(p=>({codigo_producto:p.codigo,descripcion:p.descripcion,cantidad:1,numeros_serie:[p.serial],numero_lote:null})) : d.items;
      const parts = await commit(d.marca||"", items);
      if (parts) setPrintQueue(parts);
      setImportText(""); setMode(null);
    } catch { showToast("JSON inválido","error"); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {camera && <Camera mode="photo" onPhoto={img=>{setImageData(img);setCamera(false);parsePhoto(img);}} onClose={()=>setCamera(false)}/>}
      <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Registrar Entrada</h2>
        <p style={{margin:0,color:"#64748b",fontSize:14}}>Foto de delivery note, JSON de Claude, o captura manual</p></div>
      {!mode && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {[{icon:"📷",title:"Foto",desc:"Cámara",k:"cam"},{icon:"📋",title:"JSON",desc:"Importar de Claude",k:"import"},{icon:"✏️",title:"Manual",desc:"Ingresa datos",k:"manual"}].map(o=>(
            <Card key={o.k} style={{textAlign:"center",cursor:"pointer"}}>
              <button onClick={()=>o.k==="cam"?setCamera(true):setMode(o.k)} style={{background:"none",border:"none",cursor:"pointer",width:"100%",padding:14}}>
                <div style={{fontSize:32,marginBottom:8}}>{o.icon}</div>
                <div style={{fontWeight:700,fontSize:13}}>{o.title}</div>
                <div style={{color:"#94a3b8",fontSize:11,marginTop:3}}>{o.desc}</div>
              </button>
            </Card>
          ))}
        </div>
      )}
      {mode==="photo" && (
        <Card>
          <Btn variant="outline" small onClick={()=>{setMode(null);setImageData(null);setParsed(null);}} style={{marginBottom:12}}>← Volver</Btn>

          {/* Photo preview */}
          {imageData && (
            <img src={imageData} alt="delivery note" style={{width:"100%",borderRadius:8,marginBottom:14,maxHeight:260,objectFit:"contain",background:"#f8fafc"}}/>
          )}

          {/* Parsing state */}
          {parsing && (
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"16px 0",color:"#64748b",fontSize:14}}>
              <div style={{width:20,height:20,border:"2px solid #e2e8f0",borderTop:"2px solid #000",borderRadius:"50%",animation:"spin 1s linear infinite",flexShrink:0}}/>
              Analizando delivery note con IA...
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {/* Parsed preview — confirm before registering */}
          {!parsing && parsed && (
            <div>
              <div style={{fontWeight:700,color:"#16a34a",fontSize:15,marginBottom:10}}>✓ Datos extraídos — revisa y confirma</div>

              {/* Marca */}
              <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,color:"#64748b"}}>Marca:</span>
                {parsed.marca
                  ? <Badge color="#000" text="#fff">{parsed.marca}</Badge>
                  : <Badge color="#fee2e2" text="#dc2626">⚠ Marca no detectada — confirma con Ricardo</Badge>
                }
              </div>

              {/* Barrier notice */}
              {isBarrier(parsed.marca) && (
                <div style={{marginBottom:12,background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#854d0e"}}>
                  🧩 Productos Barrier — irán a <strong>staging</strong> para que armes los kits manualmente
                </div>
              )}

              {/* Items preview */}
              <div style={{marginBottom:14}}>
                {(parsed.items||[]).map((item,i)=>(
                  <Card key={i} style={{marginBottom:8,background:"#f8fafc",padding:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                      <div style={{fontWeight:700,fontSize:14}}>{item.codigo_producto}</div>
                      <Badge color="#e0f2fe" text="#0369a1">{item.cantidad} ud{item.cantidad!==1?"s":""}</Badge>
                    </div>
                    <div style={{color:"#64748b",fontSize:12,marginBottom:8}}>{item.descripcion}</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {item.numeros_serie?.length>0
                        ? item.numeros_serie.map(sn=><Badge key={sn} color="#f0fdf4" text="#15803d">SN: {sn}</Badge>)
                        : item.numero_lote
                          ? <Badge color="#fef9c3" text="#854d0e">Lote: {item.numero_lote}</Badge>
                          : <Badge color="#f1f5f9" text="#64748b">Sin serial</Badge>
                      }
                    </div>
                  </Card>
                ))}
              </div>

              {/* Action buttons */}
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <Btn onClick={confirmParsed}>
                  ✓ Confirmar y registrar {(parsed.items||[]).reduce((acc,i)=>acc+(i.cantidad||1),0)} unidades
                </Btn>
                <Btn variant="outline" onClick={()=>setCamera(true)}>
                  📷 Tomar otra foto
                </Btn>
                <Btn variant="secondary" onClick={()=>{setParsed(null);setImageData(null);setMode(null);}}>
                  Cancelar
                </Btn>
              </div>
            </div>
          )}

          {/* Error state — parsing failed */}
          {!parsing && !parsed && imageData && (
            <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:14}}>
              <div style={{fontWeight:600,color:"#dc2626",marginBottom:6}}>⚠ No se pudieron extraer datos</div>
              <div style={{color:"#64748b",fontSize:13,marginBottom:12}}>La imagen puede estar borrosa o el formato no es reconocible.</div>
              <div style={{display:"flex",gap:10}}>
                <Btn small onClick={()=>{setParsing(true);parsePhoto(imageData);}}>Reintentar análisis</Btn>
                <Btn small variant="outline" onClick={()=>setCamera(true)}>📷 Nueva foto</Btn>
              </div>
            </div>
          )}
        </Card>
      )}
      {mode==="import" && (
        <Card>
          <Btn variant="outline" small onClick={()=>setMode(null)} style={{marginBottom:12}}>← Volver</Btn>
          <div style={{fontWeight:600,marginBottom:6}}>Pega el JSON generado por Claude</div>
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
              <Input label="Código" value={form.codigo} onChange={e=>setForm(f=>({...f,codigo:e.target.value}))} placeholder="MHD-7..."/>
            </div>
            {isBarrier(form.marca)&&<div style={{background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#854d0e"}}>🧩 Partes Barrier → staging para kits</div>}
            <Input label="Descripción" value={form.descripcion} onChange={e=>setForm(f=>({...f,descripcion:e.target.value}))}/>
            <Input label="Números de Serie (separados por coma)" value={form.seriales} onChange={e=>setForm(f=>({...f,seriales:e.target.value}))} placeholder="A065, A070"/>
            <Input label="Número de Lote (si no hay seriales)" value={form.lote} onChange={e=>setForm(f=>({...f,lote:e.target.value}))} placeholder="26029955"/>
            <Btn onClick={confirmManual} disabled={!form.marca||!form.codigo}>✓ Registrar</Btn>
          </div>
        </Card>
      )}
      <Modal open={!!printQueue} onClose={()=>setPrintQueue(null)} title="🏷️ Etiquetas generadas">
        <div style={{color:"#64748b",fontSize:13,marginBottom:14}}>Formato 50×30mm — código, serial y QR</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:14}}>
          {printQueue?.map((p,i)=>(
            <div key={i} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:10,display:"flex",alignItems:"center",gap:8}}>
              <QRCanvas text={p.qr_data} size={48}/>
              <div style={{overflow:"hidden",flex:1}}>
                <div style={{fontWeight:700,fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.codigo}</div>
                <div style={{fontSize:10,color:"#64748b",fontFamily:"monospace"}}>SN:{p.serial}</div>
              </div>
            </div>
          ))}
        </div>
        {printQueue&&<PrintButton items={printQueue}/>}
      </Modal>
    </div>
  );
}

// ─── SALIDA TAB ───────────────────────────────────────────────────────────────
function SalidaTab({ctx}) {
  const {data,mut,showToast} = ctx;
  const [camera, setCamera] = useState(false);
  const [input, setInput] = useState("");
  const [found, setFound] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [lastSold, setLastSold] = useState(null);

  const search = (val) => {
    setInput(val); setFound(null); setNotFound(false); setConfirmed(false);
    if (!val.trim()) return;
    if (val.startsWith("KIT:")) {
      const kit = (data.kits||[]).find(k=>k.qr_data===val&&k.status==="en_stock");
      kit ? setFound({...kit,isKit:true}) : setNotFound(true); return;
    }
    if (!val.includes("COD:")||!val.includes("SN:")) { if(val.length>3) setNotFound(true); return; }
    const cod = val.match(/COD:([^|]+)/)?.[1]?.trim();
    const sn  = val.match(/SN:(.+)/)?.[1]?.trim();
    if (!cod||!sn) { setNotFound(true); return; }
    const p = (data.products||[]).find(p=>p.status==="en_stock"&&p.codigo===cod&&p.serial===sn);
    p ? setFound(p) : setNotFound(true);
  };

  const confirmSale = () => {
    const ts = nowISO();
    if (found.isKit) {
      mut.updateKit(found.id,{status:"vendido",fecha_salida:ts});
      mut.logMovement({tipo:"salida",fecha:ts,marca:"BarrierTechnologies",items:found.parts?.map(p=>({codigo:p.codigo,serial:p.serial}))||[],total:found.parts?.length||0,nota:`Kit: ${found.name}`});
    } else {
      mut.updateProduct(found.id,{status:"vendido",fecha_salida:ts});
      mut.logMovement({tipo:"salida",fecha:ts,marca:found.marca,items:[{codigo:found.codigo,serial:found.serial}],total:1});
    }
    setLastSold(found); setConfirmed(true);
    showToast(`✓ Salida: ${found.isKit?found.name:found.codigo}`);
  };

  const reset = () => { setInput(""); setFound(null); setNotFound(false); setConfirmed(false); setLastSold(null); };

  return (
    <>
      {camera && <Camera mode="qr" onQR={v=>{setCamera(false);search(v);}} onClose={()=>setCamera(false)}/>}
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Registrar Salida</h2>
          <p style={{margin:0,color:"#64748b",fontSize:14}}>Escanea el QR del producto</p></div>
        <Card>
          <button onClick={()=>{reset();setCamera(true);}} style={{width:"100%",padding:"18px",border:"2px solid #000",background:"#000",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,fontFamily:"inherit",marginBottom:14}}>
            <span style={{fontSize:36}}>📷</span>
            <span style={{fontWeight:700,fontSize:15,color:"#fff",letterSpacing:1}}>ESCANEAR QR</span>
            <span style={{fontSize:11,color:"#666"}}>Toca para abrir la cámara</span>
          </button>
          <div style={{borderTop:"1px solid #f1f5f9",paddingTop:12}}>
            <div style={{fontSize:11,fontWeight:600,color:"#94a3b8",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>O ingresa manualmente</div>
            <Input value={input} onChange={e=>search(e.target.value)} placeholder="COD:MHD-7|SN:A065"/>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>Formato: COD:xxx|SN:yyy — el serial solo no es válido</div>
          </div>
        </Card>
        {found&&!confirmed&&(
          <Card style={{background:"#f0fdf4",border:"1.5px solid #86efac"}}>
            <div style={{fontWeight:700,color:"#16a34a",marginBottom:10}}>{found.isKit?"🧩 Kit identificado":"✓ Producto identificado"}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:14}}>
              <div><span style={{color:"#64748b"}}>Marca:</span> <strong>{found.marca}</strong></div>
              <div><span style={{color:"#64748b"}}>{found.isKit?"Nombre:":"Código:"}</span> <strong>{found.isKit?found.name:found.codigo}</strong></div>
              {found.isKit
                ?<div style={{gridColumn:"1/-1"}}><span style={{color:"#64748b"}}>Partes:</span> {found.parts?.map(p=><span key={p.id} style={{fontSize:12,background:"#f1f5f9",borderRadius:4,padding:"1px 6px",marginRight:4,fontFamily:"monospace"}}>{p.serial}</span>)}</div>
                :<><div style={{gridColumn:"1/-1"}}><span style={{color:"#64748b"}}>Descripción:</span> {found.descripcion}</div>
                  <div><span style={{color:"#64748b"}}>Serial:</span> <strong style={{fontFamily:"monospace"}}>{found.serial}</strong></div>
                  <div><span style={{color:"#64748b"}}>Entrada:</span> {new Date(found.fecha_entrada).toLocaleDateString("es-MX")}</div></>
              }
            </div>
            <div style={{display:"flex",gap:10,marginTop:14}}>
              <Btn onClick={confirmSale}>📤 Confirmar salida</Btn>
              <Btn variant="secondary" onClick={reset}>Cancelar</Btn>
            </div>
          </Card>
        )}
        {confirmed&&lastSold&&(
          <Card style={{background:"#f8fafc",border:"1.5px solid #000",textAlign:"center",padding:28}}>
            <div style={{fontSize:40,marginBottom:10}}>✅</div>
            <div style={{fontWeight:700,fontSize:16}}>Salida registrada</div>
            <div style={{color:"#475569",fontSize:13,marginTop:4}}>{lastSold.isKit?lastSold.name:`${lastSold.codigo} · SN:${lastSold.serial}`}</div>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:14}}>
              <Btn onClick={()=>{reset();setCamera(true);}}>📷 Escanear otro</Btn>
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
function InventarioTab({ctx}) {
  const {data,mut,showToast} = ctx;
  const [filter,setFilter] = useState("");
  const [brandFilter,setBrandFilter] = useState("all");
  const [statusFilter,setStatusFilter] = useState("en_stock");
  const [qrModal,setQrModal] = useState(null);
  const [editModal,setEditModal] = useState(null);
  const [editValue,setEditValue] = useState("");

  const products = data.products||[];
  const kits = data.kits||[];
  const brands = ["all",...new Set(products.map(p=>p.marca).filter(Boolean))];
  const knownBrands = [...new Set(products.map(p=>p.marca).filter(Boolean))].sort();
  const filtered = products.filter(p=>
    (brandFilter==="all"||p.marca===brandFilter)&&
    (statusFilter==="all"||p.status===statusFilter)&&
    (!filter||[p.codigo,p.serial,p.descripcion,p.marca].some(v=>v?.toLowerCase().includes(filter.toLowerCase())))
  );
  const stats = {
    total: products.length+kits.length,
    en_stock: products.filter(p=>p.status==="en_stock").length+kits.filter(k=>k.status==="en_stock").length,
    vendido: products.filter(p=>p.status==="vendido").length+kits.filter(k=>k.status==="vendido").length,
  };

  const confirmEdit = async () => {
    const marca = editValue.trim(); if(!marca) return;
    if (editModal.mode==="single") mut.updateProduct(editModal.product.id,{marca});
    if (editModal.mode==="bulk") products.filter(p=>p.codigo===editModal.codigo).forEach(p=>mut.updateProduct(p.id,{marca}));
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
      {kits.filter(k=>k.status==="en_stock").length>0&&(
        <Card style={{background:"#f0fdf4",border:"1.5px solid #86efac"}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🧩 Kits Barrier en stock ({kits.filter(k=>k.status==="en_stock").length})</div>
          {kits.filter(k=>k.status==="en_stock").map(k=>(
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
                      <button onClick={()=>{setEditModal({mode:"bulk",codigo:p.codigo});setEditValue(p.marca||"");}} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#94a3b8",padding:1}} title="Editar todas">↕</button>
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
                <div style={{fontSize:12,color:"#333",fontFamily:"monospace",marginTop:6}}>SN: {qrModal.serial}</div>
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
function KitsTab({ctx}) {
  const {data,mut,showToast} = ctx;
  const [selected,setSelected] = useState([]);
  const [kitName,setKitName] = useState("");
  const [printKit,setPrintKit] = useState(null);
  const [expanded,setExpanded] = useState(null);
  const staging = data.staging||[];
  const kits = data.kits||[];
  const toggle = id => setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const partType = s => {
    if(!s) return {icon:"📦",color:"#f1f5f9",text:"#475569"};
    if(s.startsWith("A")) return {icon:"🥼",color:"#dbeafe",text:"#1d4ed8"};
    if(s.startsWith("T")) return {icon:"🛡️",color:"#f0fdf4",text:"#16a34a"};
    return {icon:"📦",color:"#fef9c3",text:"#854d0e"};
  };
  const createKit = () => {
    if(!selected.length){showToast("Selecciona al menos una parte","error");return;}
    const kitId = makeId();
    const parts = staging.filter(p=>selected.includes(p.id));
    const name = kitName.trim()||`Kit Barrier ${kits.length+1}`;
    const k = {id:kitId,name,marca:"BarrierTechnologies",partIds:selected,parts:parts.map(p=>({id:p.id,codigo:p.codigo,serial:p.serial,descripcion:p.descripcion})),qr_data:`KIT:${kitId}`,status:"en_stock",fecha_creacion:nowISO(),fecha_salida:null};
    mut.removeStaging(selected);
    mut.addKit(k);
    mut.logMovement({tipo:"kit_creado",fecha:nowISO(),marca:"BarrierTechnologies",items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length,nota:`Kit: ${name}`});
    setSelected([]); setKitName(""); setPrintKit(k);
    showToast(`✓ Kit "${name}" creado`);
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Kits — Barrier Technologies</h2>
        <p style={{margin:0,color:"#64748b",fontSize:14}}>Asocia partes sueltas en kits con QR único</p></div>
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
            <div>Sin partes en staging — registra una entrada de Barrier</div>
          </div>
        ):(
          <>
            {[{prefix:"A",label:"🥼 Mandiles"},{prefix:"T",label:"🛡️ Tiroides"},{prefix:null,label:"📦 Otros"}].map(g=>{
              const gp = staging.filter(p=>g.prefix?p.serial?.startsWith(g.prefix):!p.serial?.startsWith("A")&&!p.serial?.startsWith("T"));
              if(!gp.length) return null;
              return (
                <div key={g.label} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#64748b",marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>{g.label} ({gp.length})</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(148px,1fr))",gap:8}}>
                    {gp.map(p=>{
                      const sel=selected.includes(p.id),pt=partType(p.serial);
                      return (
                        <button key={p.id} onClick={()=>toggle(p.id)} style={{border:sel?"2px solid #000":"1.5px solid #e2e8f0",background:sel?"#000":pt.color,color:sel?"#fff":pt.text,borderRadius:8,padding:"10px 12px",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .1s"}}>
                          <div style={{fontSize:11,opacity:.7,marginBottom:3}}>{pt.icon}</div>
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
            <div style={{borderTop:"1.5px solid #e2e8f0",paddingTop:14}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:160}}>
                  <Input label={`Nombre del kit — ${selected.length} parte(s) seleccionada(s)`} value={kitName} onChange={e=>setKitName(e.target.value)} placeholder={`Kit Barrier ${kits.length+1}`}/>
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
                      <span style={{fontSize:11,color:"#94a3b8"}}>{kit.parts?.length} partes · {new Date(kit.fecha_creacion).toLocaleDateString("es-MX")}</span>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10,cursor:"pointer"}} onClick={()=>setExpanded(expanded===kit.id?null:kit.id)}>
                      {kit.parts?.map(p=><span key={p.id} style={{fontSize:11,background:"#f1f5f9",borderRadius:5,padding:"2px 8px",fontFamily:"monospace"}}>{partType(p.serial).icon} SN:{p.serial}</span>)}
                    </div>
                    {expanded===kit.id&&(
                      <div style={{background:"#f8fafc",borderRadius:8,padding:10,marginBottom:10}}>
                        {kit.parts?.map(p=><div key={p.id} style={{fontSize:12,color:"#475569",marginBottom:3}}><strong>{p.codigo}</strong> · SN:{p.serial} · <span style={{color:"#94a3b8"}}>{p.descripcion}</span></div>)}
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
              {printKit.parts?.map(p=><span key={p.id} style={{fontSize:11,background:"#f1f5f9",borderRadius:5,padding:"2px 8px",fontFamily:"monospace"}}>{partType(p.serial).icon} {p.serial}</span>)}
            </div>
            <div style={{marginTop:16}}><PrintButton items={[{...printKit,isKit:true}]}/></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── HISTORIAL TAB ────────────────────────────────────────────────────────────
function HistorialTab({ctx}) {
  const {data} = ctx;
  const sorted = [...(data.movements||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  const cfg = {
    entrada:        {icon:"📥",bg:"#dcfce7",text:"#16a34a",label:"Entrada"},
    salida:         {icon:"📤",bg:"#fef9c3",text:"#854d0e",label:"Salida"},
    entrada_barrier:{icon:"🗂️",bg:"#dbeafe",text:"#1d4ed8",label:"Entrada Barrier"},
    kit_creado:     {icon:"🧩",bg:"#f0fdf4",text:"#166534",label:"Kit creado"},
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:700}}>Historial</h2>
        <p style={{margin:0,color:"#64748b",fontSize:14}}>{sorted.length} movimientos</p></div>
      {sorted.length===0&&<Card style={{textAlign:"center",padding:40,color:"#94a3b8"}}><div style={{fontSize:36,marginBottom:8}}>📋</div>Sin movimientos aún</Card>}
      {sorted.map((m,i)=>{
        const c=cfg[m.tipo]||{icon:"•",bg:"#f1f5f9",text:"#64748b",label:m.tipo};
        return (
          <Card key={i}>
            <div style={{display:"flex",gap:12}}>
              <div style={{width:40,height:40,borderRadius:10,flexShrink:0,background:c.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{c.icon}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:4}}>
                  <Badge color={c.bg} text={c.text}>{c.label}</Badge>
                  <Badge color="#000" text="#fff">{m.marca}</Badge>
                  <span style={{fontSize:11,color:"#94a3b8"}}>{new Date(m.fecha).toLocaleString("es-MX")}</span>
                </div>
                {m.nota&&<div style={{fontSize:11,color:"#64748b",fontStyle:"italic",marginBottom:4}}>{m.nota}</div>}
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {(Array.isArray(m.items)?m.items:[]).slice(0,8).map((item,j)=>(
                    <span key={j} style={{fontSize:10,background:"#f1f5f9",borderRadius:4,padding:"1px 7px",fontFamily:"monospace"}}>{item.codigo}·{item.serial}</span>
                  ))}
                  {(Array.isArray(m.items)?m.items:[]).length>8&&<span style={{fontSize:10,color:"#94a3b8"}}>+{m.items.length-8} más</span>}
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
