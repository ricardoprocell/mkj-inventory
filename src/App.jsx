import { useState, useRef, useEffect, useCallback } from "react";

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
      try { new window.QRCode(ref.current, { text, width: size, height: size, colorDark: "#000", colorLight: "#fff", correctLevel: window.QRCode.CorrectLevel.M }); } catch {}
    });
  }, [text, size]);
  return <div ref={ref} style={{ width: size, height: size, display: "inline-block" }} />;
}

const generateQRDataUrl = (text, size = 200) => new Promise(async res => {
  await loadQRLib();
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(el);
  try {
    new window.QRCode(el, { text, width: size, height: size, colorDark: "#000", colorLight: "#fff", correctLevel: window.QRCode.CorrectLevel.M });
    setTimeout(() => {
      const canvas = el.querySelector("canvas");
      const img = el.querySelector("img");
      res(canvas ? canvas.toDataURL("image/png") : img ? img.src : "");
      document.body.removeChild(el);
    }, 120);
  } catch { document.body.removeChild(el); res(""); }
});

// ─── Print labels 50×30 mm — info LEFT, QR RIGHT ─────────────────────────────
const printLabels = async (items) => {
  const entries = await Promise.all(items.map(async p => ({ ...p, dataUrl: await generateQRDataUrl(p.qr_data, 180) })));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas MKJ Trade</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#fff;font-family:'Helvetica Neue',Arial,sans-serif}
    .page{display:flex;flex-wrap:wrap;padding:4mm;gap:2mm}
    .label{
      width:50mm;height:30mm;
      border:0.4mm solid #000;
      display:flex;align-items:stretch;
      page-break-inside:avoid;
      overflow:hidden;
    }
    /* LEFT: text info */
    .info{
      flex:1;
      display:flex;flex-direction:column;justify-content:center;
      padding:2mm 2mm 2mm 3mm;
      border-right:0.3mm solid #000;
      overflow:hidden;
    }
    .mkj{font-size:5pt;color:#999;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:2mm}
    .cod{font-size:8.5pt;font-weight:700;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.2px;line-height:1.2}
    .sn{font-size:7pt;color:#333;font-family:'Courier New',monospace;margin-top:1.5mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
    /* RIGHT: QR */
    .qr{
      width:26mm;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      padding:2mm;
    }
    .qr img{width:22mm;height:22mm;display:block}
    @media print{
      body{margin:0}
      .page{padding:0;gap:0}
      .label{border-color:#000}
    }
  </style></head><body>
  <div class="page">
    ${entries.map(p => {
      const cod = p.isKit ? (p.name || p.codigo) : p.codigo;
      const sn  = p.isKit ? (p.parts||[]).map(x=>x.serial).join(" + ") : p.serial;
      return `<div class="label">
        <div class="info">
          <div class="mkj">MKJ TRADE</div>
          <div class="cod">${cod}</div>
          <div class="sn">SN: ${sn}</div>
        </div>
        <div class="qr"><img src="${p.dataUrl}"/></div>
      </div>`;
    }).join("")}
  </div>
  <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`;
  const w = window.open("","_blank");
  if (w) { w.document.write(html); w.document.close(); }
};



// ─── Print button — Safari/iOS compatible ────────────────────────────────────
// Generates label images and lets user share directly to Niimbot app or save
function PrintButton({ items, small=false }) {
  const [status, setStatus] = useState(null);
  const [imgModal, setImgModal] = useState(null); // { images: [{dataUrl, label}] }

  const generateImages = async () => {
    setStatus("generating");
    const images = [];
    for (const item of items) {
      const dataUrl = await printToNiimbot(item);
      const cod = item.isKit ? (item.name||item.codigo) : item.codigo;
      const sn  = item.isKit ? (item.parts||[]).map(p=>p.serial).join("+") : item.serial;
      images.push({ dataUrl, label: `${cod} · SN:${sn}` });
    }
    setStatus(null);
    setImgModal({ images });
  };

  if (status==="generating") return <Btn disabled small={small}>⏳ Generando...</Btn>;

  return (
    <>
      <Btn small={small} onClick={generateImages}>🖨️ Imprimir etiqueta</Btn>
      {imgModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setImgModal(null)}>
          <div style={{background:"#fff",borderRadius:16,padding:24,maxWidth:400,width:"100%",maxHeight:"88vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{margin:0,fontSize:16,fontWeight:700}}>Etiquetas listas</h3>
              <button onClick={()=>setImgModal(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94a3b8"}}>✕</button>
            </div>

            {/* Instructions */}
            <div style={{background:"#f8fafc",borderRadius:10,padding:12,marginBottom:16,fontSize:13,color:"#475569",lineHeight:1.6}}>
              <strong style={{color:"#000"}}>Cómo imprimir en la Niimbot B1:</strong><br/>
              1. Mantén presionada la imagen de abajo<br/>
              2. Toca <strong>"Compartir"</strong> → busca <strong>"NIIMBOT"</strong><br/>
              3. En la app Niimbot selecciona tu impresora B1<br/>
              4. Ajusta al tamaño 50×30mm y confirma
            </div>

            {/* Label images */}
            {imgModal.images.map((img, i) => (
              <div key={i} style={{marginBottom:14,textAlign:"center"}}>
                <div style={{fontSize:11,color:"#94a3b8",marginBottom:6}}>{img.label}</div>
                <img
                  src={img.dataUrl}
                  alt={img.label}
                  style={{width:"100%",borderRadius:8,border:"1px solid #e2e8f0",display:"block"}}
                />
                <a
                  href={img.dataUrl}
                  download={`etiqueta-${img.label.replace(/[^a-zA-Z0-9]/g,"-")}.png`}
                  style={{display:"inline-block",marginTop:8,fontSize:12,color:"#000",fontWeight:600,textDecoration:"underline"}}
                >
                  ↓ Descargar imagen
                </a>
              </div>
            ))}

            <div style={{marginTop:12,fontSize:11,color:"#94a3b8",textAlign:"center"}}>
              La app NIIMBOT debe estar instalada para compartir directo a la impresora
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Niimbot B1 Web Bluetooth printer ────────────────────────────────────────
// Implements core Niimbot BLE protocol to print directly from browser
// iOS: requires Bluefy browser ($2 App Store). Android/Mac: Chrome native.

const NIIMBOT_SERVICE = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
const NIIMBOT_CHAR    = "be15bee0-6186-407e-8381-0bd89c4d8df4";

const NiimCmd = {
  SET_LABEL_TYPE:    0x23,
  SET_LABEL_DENSITY: 0x21,
  START_PRINT:       0x01,
  END_PRINT:         0xF3,
  START_PAGE_PRINT:  0x03,
  END_PAGE_PRINT:    0xE3,
  SET_DIMENSION:     0x13,
  SET_QUANTITY:      0x15,
  WRITE_DATA:        0x85,
};

function niimPkt(cmd, data=[]) {
  const len = data.length;
  const buf = new Uint8Array(len + 6);
  buf[0] = 0x55; buf[1] = 0x55;
  buf[2] = cmd; buf[3] = len;
  buf.set(data, 4);
  let cs = 0; for(let i=2;i<4+len;i++) cs ^= buf[i];
  buf[4+len] = cs; buf[5+len] = 0xAA;
  return buf;
}

async function niimbotPrint(imageData, labelW=50, labelH=30) {
  if (!navigator.bluetooth) throw new Error("Este navegador no soporta Web Bluetooth. En iPhone usa Bluefy, en Android/Mac usa Chrome.");
  
  const device = await navigator.bluetooth.requestDevice({
    filters:[{namePrefix:"B1"},{namePrefix:"D11"},{namePrefix:"D110"}],
    optionalServices:[NIIMBOT_SERVICE]
  });
  
  const server = await device.gatt.connect();
  const svc    = await server.getPrimaryService(NIIMBOT_SERVICE);
  const char   = await svc.getCharacteristic(NIIMBOT_CHAR);

  const send = async (cmd, data=[]) => {
    await char.writeValueWithResponse(niimPkt(cmd, data));
    await new Promise(r=>setTimeout(r,20));
  };

  // Render image to 1-bit bitmap at 96dpi (B1 native res 203dpi, scale accordingly)
  const canvas = document.createElement("canvas");
  const DPI = 203;
  const mmToPx = mm => Math.round(mm * DPI / 25.4);
  canvas.width  = mmToPx(labelW);
  canvas.height = mmToPx(labelH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  const img = new Image();
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=imageData; });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const px = ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const W = canvas.width, H = canvas.height;
  const rowBytes = Math.ceil(W/8);
  const rows = [];
  for(let y=0;y<H;y++){
    const row = new Uint8Array(rowBytes);
    for(let x=0;x<W;x++){
      const i=(y*W+x)*4;
      const lum=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2];
      if(lum<128) row[x>>3]|=(0x80>>(x&7));
    }
    rows.push(row);
  }

  // Print sequence
  await send(NiimCmd.SET_LABEL_TYPE,    [1]);
  await send(NiimCmd.SET_LABEL_DENSITY, [5]);
  await send(NiimCmd.START_PRINT,       [1]);
  await send(NiimCmd.START_PAGE_PRINT);
  await send(NiimCmd.SET_DIMENSION,     [H>>8,H&0xFF,W>>8,W&0xFF]);
  await send(NiimCmd.SET_QUANTITY,      [0,1]);

  for(let y=0;y<rows.length;y++){
    const row=rows[y];
    const pkt=new Uint8Array(row.length+3);
    pkt[0]=y>>8; pkt[1]=y&0xFF; pkt[2]=1;
    pkt.set(row,3);
    await send(NiimCmd.WRITE_DATA, Array.from(pkt));
  }

  await send(NiimCmd.END_PAGE_PRINT);
  await send(NiimCmd.END_PRINT,[1]);
  device.gatt.disconnect();
}

// Renders a label to canvas dataURL then sends to Niimbot
async function printToNiimbot(item) {
  const canvas = document.createElement("canvas");
  const W=472, H=283; // 50x30mm at 240dpi
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="#000"; ctx.lineWidth=2; ctx.strokeRect(1,1,W-2,H-2);

  // Left: text
  const cod = item.isKit?(item.name||item.codigo):item.codigo;
  const sn  = item.isKit?(item.parts||[]).map(p=>p.serial).join("+"):item.serial;
  ctx.fillStyle="#bbb"; ctx.font="bold 16px 'Helvetica Neue',Arial";
  ctx.fillText("MKJ TRADE",14,26);
  ctx.fillStyle="#000"; ctx.font="bold 34px 'Helvetica Neue',Arial";
  const codText=cod.length>10?cod.slice(0,10)+"…":cod;
  ctx.fillText(codText,14,78);
  ctx.fillStyle="#333"; ctx.font="22px 'Courier New',monospace";
  ctx.fillText("SN: "+sn,14,118);

  // Right: QR
  const qrDataUrl=await generateQRDataUrl(item.qr_data,200);
  const qrImg=new Image();
  await new Promise((res,rej)=>{ qrImg.onload=res; qrImg.onerror=rej; qrImg.src=qrDataUrl; });
  ctx.drawImage(qrImg,W-240,20,220,220);

  return canvas.toDataURL("image/png");
}

// ─── jsQR scanner ────────────────────────────────────────────────────────────
const loadJsQR = (() => {
  let p = null;
  return () => p || (p = new Promise(res => {
    if (window.jsQR) return res(window.jsQR);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js";
    s.onload = () => res(window.jsQR); document.head.appendChild(s);
  }));
})();

function QRScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [err, setErr] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const jsQR = await loadJsQR();
      try {
        // Try rear camera first, fall back to any camera (needed for some iOS versions)
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
        const tick = () => {
          if (!alive) return;
          const v = videoRef.current, c = canvasRef.current;
          if (v && c && v.readyState === 4) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code?.data) { onScan(code.data); return; }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch { setErr("No se pudo acceder a la cámara. Revisa los permisos del navegador."); }
    })();
    return () => {
      alive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:3000, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"#000", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #222" }}>
        <span style={{ color:"#fff", fontWeight:700, letterSpacing:1 }}>ESCANEAR QR</span>
        <button onClick={onClose} style={{ background:"#222", border:"none", color:"#fff", padding:"8px 16px", borderRadius:6, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>✕ Cerrar</button>
      </div>
      <div style={{ flex:1, position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <video ref={videoRef} playsInline muted style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        <canvas ref={canvasRef} style={{ display:"none" }} />
        {ready && (
          <div style={{ position:"absolute", width:200, height:200, pointerEvents:"none" }}>
            {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h]) => (
              <div key={v+h} style={{ position:"absolute", width:24, height:24,
                [v]:0, [h]:0,
                borderTop: v==="top" ? "3px solid #fff" : "none",
                borderBottom: v==="bottom" ? "3px solid #fff" : "none",
                borderLeft: h==="left" ? "3px solid #fff" : "none",
                borderRight: h==="right" ? "3px solid #fff" : "none",
              }} />
            ))}
            <div style={{ position:"absolute", left:6, right:6, height:2, background:"#fff", top:"50%", animation:"scan 1.6s ease-in-out infinite", boxShadow:"0 0 6px rgba(255,255,255,.7)" }} />
          </div>
        )}
        {!ready && !err && <div style={{ color:"#fff", fontSize:14 }}>Iniciando cámara...</div>}
        {err && <div style={{ color:"#fca5a5", fontSize:13, padding:24, textAlign:"center", maxWidth:260 }}>⚠ {err}</div>}
      </div>
      <div style={{ background:"#111", padding:"12px 20px", textAlign:"center", color:"#666", fontSize:12, letterSpacing:1 }}>
        Apunta al QR pegado en el producto
      </div>
      <style>{`@keyframes scan{0%{top:8%}50%{top:88%}100%{top:8%}}`}</style>
    </div>
  );
}

// ─── Photo capture (cámara trasera) ──────────────────────────────────────────
function PhotoCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const [captured, setCaptured] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      } catch { setErr("No se pudo acceder a la cámara. Revisa los permisos del navegador en Ajustes → Safari → Cámara."); }
    })();
    return () => { alive = false; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const snap = () => {
    const v = videoRef.current, c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    setCaptured(c.toDataURL("image/jpeg", 0.92));
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  const confirm = () => { onCapture(captured); onClose(); };
  const retake = () => {
    setCaptured(null);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(s => {
      streamRef.current = s;
      videoRef.current.srcObject = s;
      videoRef.current.play();
    });
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:3000, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"#000", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #222" }}>
        <span style={{ color:"#fff", fontWeight:700, letterSpacing:1 }}>FOTO DE DELIVERY NOTE</span>
        <button onClick={onClose} style={{ background:"#222", border:"none", color:"#fff", padding:"8px 16px", borderRadius:6, cursor:"pointer", fontFamily:"inherit" }}>✕</button>
      </div>
      <div style={{ flex:1, position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {!captured ? (
          <video ref={videoRef} playsInline muted style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        ) : (
          <img src={captured} style={{ width:"100%", height:"100%", objectFit:"contain" }} alt="preview" />
        )}
        <canvas ref={canvasRef} style={{ display:"none" }} />
        {err && <div style={{ color:"#fca5a5", fontSize:13, padding:24, textAlign:"center" }}>⚠ {err}</div>}
      </div>
      <div style={{ background:"#111", padding:"16px 24px", display:"flex", justifyContent:"center", gap:16 }}>
        {!captured ? (
          <button onClick={snap} disabled={!ready} style={{ background:"#fff", border:"none", borderRadius:"50%", width:64, height:64, fontSize:28, cursor: ready?"pointer":"not-allowed", opacity: ready?1:.4 }}>📷</button>
        ) : (
          <>
            <button onClick={retake} style={{ background:"#333", border:"none", color:"#fff", padding:"12px 24px", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>↩ Repetir</button>
            <button onClick={confirm} style={{ background:"#fff", border:"none", color:"#000", padding:"12px 28px", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>✓ Usar esta foto</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
const Badge = ({ children, color="#e2e8f0", text="#1e293b" }) => (
  <span style={{ background:color, color:text, borderRadius:6, padding:"2px 10px", fontSize:12, fontWeight:600, letterSpacing:.3 }}>{children}</span>
);
const Btn = ({ children, onClick, variant="primary", disabled, small, style={} }) => {
  const v = { primary:{background:"#000",color:"#fff",borderRadius:0,letterSpacing:.5}, secondary:{background:"#f1f5f9",color:"#0f172a",borderRadius:6}, success:{background:"#dcfce7",color:"#16a34a",borderRadius:6}, outline:{background:"transparent",color:"#000",border:"1.5px solid #000",borderRadius:0}, danger:{background:"#fee2e2",color:"#dc2626",borderRadius:6} };
  return <button style={{ border:"none", cursor:disabled?"not-allowed":"pointer", fontFamily:"inherit", fontWeight:600, transition:"all .15s", opacity:disabled?.45:1, display:"inline-flex", alignItems:"center", gap:6, padding:small?"6px 14px":"10px 20px", fontSize:small?13:14, ...v[variant], ...style }} onClick={onClick} disabled={disabled}>{children}</button>;
};
const Card = ({ children, style={} }) => <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e2e8f0", padding:20, ...style }}>{children}</div>;
const Input = ({ label, ...props }) => (
  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
    {label && <label style={{ fontSize:12, fontWeight:600, color:"#64748b" }}>{label}</label>}
    <input {...props} style={{ border:"1.5px solid #e2e8f0", borderRadius:8, padding:"8px 12px", fontSize:14, fontFamily:"inherit", outline:"none", background:"#fafafa", color:"#0f172a", ...props.style }} />
  </div>
);
const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:14, padding:24, maxWidth:600, width:"100%", maxHeight:"88vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.3)" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <h3 style={{ margin:0, fontSize:17, fontWeight:700 }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#94a3b8" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:1500, system, messages })
  });
  const d = await res.json();
  return d.content?.find(b=>b.type==="text")?.text || "";
}

// ─── Store ────────────────────────────────────────────────────────────────────
const STORE_KEY = "inv_mkj_v1";
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const NOW = new Date().toISOString();
const isBarrier = marca => marca?.toLowerCase().includes("barrier");

// Seed data (only used on first ever load)
const SEED_PRODUCTS = [
  { marca:"Fehling", codigo:"BSM-7", descripcion:"CERAMO PLANO micro vasc. scis., blade 7mm, 45° angl., 180mm", serial:"A043" },
  { marca:"Fehling", codigo:"BSM-7", descripcion:"CERAMO PLANO micro vasc. scis., blade 7mm, 45° angl., 180mm", serial:"A042" },
  { marca:"Fehling", codigo:"MRB-6B", descripcion:"CERAMO HCR knot pusher with lock, 25° angl., 340mm", serial:"A037" },
  { marca:"Sutter", codigo:"780198SGS", descripcion:"Bipolar forceps SuperGliss®, US, 22cm, bayonet, tip 1.0×8.0mm", serial:"2602955-001" },
  { marca:"Sutter", codigo:"780198SGS", descripcion:"Bipolar forceps SuperGliss®, US, 22cm, bayonet, tip 1.0×8.0mm", serial:"2602955-002" },
  { marca:"Sutter", codigo:"780198SGS", descripcion:"Bipolar forceps SuperGliss®, US, 22cm, bayonet, tip 1.0×8.0mm", serial:"2602955-003" },
  { marca:"Sutter", codigo:"780198SGS", descripcion:"Bipolar forceps SuperGliss®, US, 22cm, bayonet, tip 1.0×8.0mm", serial:"2602955-004" },
  { marca:"Sutter", codigo:"782181SGS", descripcion:"Bipolar forceps SuperGliss®, US, 19cm, bayonet, tip 1.0×8.0mm", serial:"2510853-001" },
  { marca:"Sutter", codigo:"782181SGS", descripcion:"Bipolar forceps SuperGliss®, US, 19cm, bayonet, tip 1.0×8.0mm", serial:"2510853-002" },
  { marca:"Sutter", codigo:"782181SGS", descripcion:"Bipolar forceps SuperGliss®, US, 19cm, bayonet, tip 1.0×8.0mm", serial:"2510853-003" },
  { marca:"Sutter", codigo:"701767", descripcion:"Instrument Tray, US, for 10 SuperGliss forceps", serial:"SIN-SERIAL" },
  { marca:"Sutter", codigo:"780169SLS", descripcion:"Bipolar forceps SuperGliss® ELP, US, 16cm, bayonet, tip 0.4×6.0mm", serial:"2603936-001" },
  { marca:"Sutter", codigo:"780298SGS", descripcion:"Bipolar forceps SuperGliss®, US, 24cm, bayonet, tip 1.0×8.0mm", serial:"2603913-001" },
  { marca:"Sutter", codigo:"780298SGS", descripcion:"Bipolar forceps SuperGliss®, US, 24cm, bayonet, tip 1.0×8.0mm", serial:"2603913-002" },
  { marca:"Sutter", codigo:"780298SGS", descripcion:"Bipolar forceps SuperGliss®, US, 24cm, bayonet, tip 1.0×8.0mm", serial:"2603913-003" },
  { marca:"Sutter", codigo:"780292SGS", descripcion:"Bipolar forceps SuperGliss®, US, 24cm, bayonet, tip 1.2×8.0mm", serial:"2605263-001" },
  { marca:"Sutter", codigo:"780292SGS", descripcion:"Bipolar forceps SuperGliss®, US, 24cm, bayonet, tip 1.2×8.0mm", serial:"2605263-002" },
  { marca:"Sutter", codigo:"782154SGS", descripcion:"Bipolar forceps SuperGliss®, US, 15.5cm, straight, tip 0.4×8.0mm MicroTip", serial:"2605936-001" },
  { marca:"Sutter", codigo:"782154SGS", descripcion:"Bipolar forceps SuperGliss®, US, 15.5cm, straight, tip 0.4×8.0mm MicroTip", serial:"2605936-002" },
  { marca:"Sutter", codigo:"782154SGS", descripcion:"Bipolar forceps SuperGliss®, US, 15.5cm, straight, tip 0.4×8.0mm MicroTip", serial:"2605936-003" },
  { marca:"Sutter", codigo:"701765", descripcion:"Instrument Tray, US, for 5 SuperGliss® forceps", serial:"SIN-SERIAL" },
].map(p => ({ ...p, id:makeId(), qr_data:`COD:${p.codigo}|SN:${p.serial}`, status:"en_stock", fecha_entrada:NOW, fecha_salida:null }));

const loadStore = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      // Existing data — ONLY additive fixes, never delete products
      const saved = JSON.parse(raw);
      if (!saved.kits) saved.kits = [];
      if (!saved.barrierStaging) saved.barrierStaging = [];
      if (!saved.movements) saved.movements = [];
      if (!saved.products) saved.products = [];
      return saved;
    }
    // No data yet — fresh install, start with empty store (no seed)
    // User will import their real data via the backup/restore tool
    const empty = { products: [], movements: [], kits: [], barrierStaging: [] };
    localStorage.setItem(STORE_KEY, JSON.stringify(empty));
    return empty;
  } catch {
    return { products: [], movements: [], kits: [], barrierStaging: [] };
  }
};
const saveStore = d => localStorage.setItem(STORE_KEY, JSON.stringify(d));

// ─── Backup / Restore ────────────────────────────────────────────────────────
function BackupButton({ store, setStore, showToast }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef();

  const doExport = () => {
    const json = JSON.stringify(store, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mkj-inventario-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✓ Respaldo descargado");
    setOpen(false);
  };

  const doImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.products) throw new Error("Formato inválido");
        if (!data.kits) data.kits = [];
        if (!data.barrierStaging) data.barrierStaging = [];
        if (!data.movements) data.movements = [];
        setStore(data);
        showToast(`✓ Inventario restaurado — ${data.products.length} productos`);
        setOpen(false);
      } catch { showToast("Archivo inválido", "error"); }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} title="Respaldo" style={{ background:"none", border:"1px solid #333", color:"#888", borderRadius:6, padding:"4px 8px", cursor:"pointer", fontSize:11, letterSpacing:.5 }}>
        ⬆⬇
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Respaldo de inventario">
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ background:"#f8fafc", borderRadius:10, padding:14, fontSize:13, color:"#475569", lineHeight:1.6 }}>
            Exporta tu inventario como archivo JSON para guardarlo como respaldo. Si cambias de dispositivo o navegador, impórtalo para restaurar todos tus datos.
          </div>
          <Btn onClick={doExport}>⬇ Exportar respaldo (.json)</Btn>
          <div style={{ borderTop:"1px solid #f1f5f9", paddingTop:14 }}>
            <div style={{ fontSize:12, fontWeight:600, color:"#64748b", marginBottom:8 }}>Restaurar desde respaldo</div>
            <input ref={fileRef} type="file" accept=".json" onChange={doImport} style={{ display:"none" }} />
            <Btn variant="outline" onClick={() => fileRef.current.click()}>⬆ Importar respaldo</Btn>
          </div>
          <div style={{ fontSize:11, color:"#dc2626", background:"#fef2f2", borderRadius:8, padding:10 }}>
            ⚠ Importar un respaldo reemplaza todo el inventario actual. Exporta primero si quieres conservar los datos actuales.
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = ["📥 Entrada","📤 Salida","📦 Inventario","🧩 Kits Barrier","📊 Historial"];

export default function App() {
  const [tab, setTab] = useState(0);
  const [store, setStoreRaw] = useState(loadStore);
  const [toast, setToast] = useState(null);

  const setStore = fn => setStoreRaw(prev => { const next = typeof fn==="function"?fn(prev):fn; saveStore(next); return next; });
  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  const stagingCount = (store.barrierStaging||[]).length;

  return (
    <div style={{ minHeight:"100vh", background:"#f5f5f5", fontFamily:"'Inter','Segoe UI',sans-serif" }}>
      {/* Header */}
      <div style={{ background:"#000", color:"#fff", padding:"14px 20px", display:"flex", alignItems:"center", gap:14 }}>
        <svg width="48" height="48" viewBox="0 0 52 52" fill="none">
          <circle cx="26" cy="26" r="23" stroke="#fff" strokeWidth="2" fill="none"/>
          <text x="8" y="33" fontFamily="'Helvetica Neue',Arial,sans-serif" fontWeight="700" fontSize="16" fill="#fff">M</text>
          <text x="20" y="33" fontFamily="'Helvetica Neue',Arial,sans-serif" fontWeight="700" fontSize="16" fill="#fff">K</text>
          <text x="32" y="33" fontFamily="'Helvetica Neue',Arial,sans-serif" fontWeight="700" fontSize="16" fill="#fff">J</text>
        </svg>
        <div style={{ borderLeft:"1px solid #333", paddingLeft:14 }}>
          <div style={{ fontWeight:300, fontSize:17, letterSpacing:6, textTransform:"uppercase" }}>TRADE</div>
          <div style={{ fontSize:9, color:"#666", letterSpacing:2, textTransform:"uppercase", marginTop:1 }}>Control de Inventario</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:20, fontWeight:700 }}>{store.products.filter(p=>p.status==="en_stock").length + (store.kits||[]).filter(k=>k.status==="en_stock").length}</div>
            <div style={{ fontSize:9, color:"#666", letterSpacing:1, textTransform:"uppercase" }}>en stock</div>
          </div>
          <BackupButton store={store} setStore={setStore} showToast={showToast} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:"#fff", borderBottom:"1.5px solid #e5e5e5", display:"flex", overflowX:"auto", padding:"0 16px" }}>
        {TABS.map((t,i) => (
          <button key={i} onClick={()=>setTab(i)} style={{ position:"relative", border:"none", background:"none", padding:"13px 14px", cursor:"pointer", fontWeight:tab===i?700:400, color:tab===i?"#000":"#999", borderBottom:tab===i?"2.5px solid #000":"2.5px solid transparent", fontSize:12, fontFamily:"inherit", whiteSpace:"nowrap", letterSpacing:.3 }}>
            {t}
            {i===3 && stagingCount>0 && <span style={{ position:"absolute", top:8, right:4, background:"#dc2626", color:"#fff", borderRadius:10, fontSize:9, padding:"1px 5px", fontWeight:700 }}>{stagingCount}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding:16, maxWidth:900, margin:"0 auto" }}>
        {tab===0 && <EntradaTab store={store} setStore={setStore} showToast={showToast} setTab={setTab} />}
        {tab===1 && <SalidaTab store={store} setStore={setStore} showToast={showToast} />}
        {tab===2 && <InventarioTab store={store} setStore={setStore} showToast={showToast} />}
        {tab===3 && <KitsTab store={store} setStore={setStore} showToast={showToast} />}
        {tab===4 && <HistorialTab store={store} />}
      </div>

      {toast && <div style={{ position:"fixed", bottom:20, right:20, background:toast.type==="success"?"#000":"#dc2626", color:"#fff", padding:"11px 18px", fontSize:13, fontWeight:500, letterSpacing:.3, boxShadow:"0 4px 20px rgba(0,0,0,.3)", zIndex:4000, borderLeft:"3px solid #fff", maxWidth:320 }}>{toast.msg}</div>}
    </div>
  );
}

// ─── ENTRADA TAB ──────────────────────────────────────────────────────────────
function EntradaTab({ store, setStore, showToast, setTab }) {
  const [mode, setMode] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [imageData, setImageData] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [printQueue, setPrintQueue] = useState(null);
  const [importText, setImportText] = useState("");
  const [form, setForm] = useState({ marca:"", codigo:"", descripcion:"", seriales:"", lote:"" });
  const fileRef = useRef();

  const buildParts = (marca, items) => {
    const out = [];
    items.forEach(item => {
      if (isBarrier(marca) && item.codigo_producto?.startsWith("MON-P")) return;
      let serials = item.numeros_serie?.length > 0 ? item.numeros_serie
        : item.numero_lote ? Array.from({length:item.cantidad},(_,i)=>`${item.numero_lote}-${String(i+1).padStart(3,"0")}`)
        : ["SIN-SERIAL"];
      if (isBarrier(marca)) serials = serials.filter(sn=>!sn.startsWith("BT"));
      serials.forEach(sn => out.push({ id:makeId(), marca, codigo:item.codigo_producto, descripcion:item.descripcion, serial:sn, qr_data:`COD:${item.codigo_producto}|SN:${sn}`, status:"en_stock", fecha_entrada:new Date().toISOString(), fecha_salida:null }));
    });
    return out;
  };

  const commitEntry = (marca, items) => {
    const parts = buildParts(marca, items);
    if (parts.length === 0) { showToast("No hay productos válidos para registrar", "error"); return null; }
    if (isBarrier(marca)) {
      setStore(prev => ({ ...prev, barrierStaging:[...(prev.barrierStaging||[]),...parts], movements:[...prev.movements,{tipo:"entrada_barrier_staging",fecha:new Date().toISOString(),marca,items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length,nota:"Partes enviadas a staging Barrier para armar kits"}] }));
      showToast(`✓ ${parts.length} partes de Barrier en staging — arma los kits en la pestaña 🧩`);
      setTimeout(()=>setTab(3), 1200);
      return null;
    }
    setStore(prev => ({ ...prev, products:[...prev.products,...parts], movements:[...prev.movements,{tipo:"entrada",fecha:new Date().toISOString(),marca,items:parts.map(p=>({codigo:p.codigo,serial:p.serial})),total:parts.length}] }));
    showToast(`✓ ${parts.length} unidades registradas en inventario`);
    return parts;
  };

  const parseImage = async (imgData) => {
    setParsing(true); setParsed(null);
    try {
      const base64 = imgData.split(",")[1];
      const mediaType = imgData.split(";")[0].split(":")[1];
      const text = await callClaude([{ role:"user", content:[
        { type:"image", source:{ type:"base64", media_type:mediaType, data:base64 } },
        { type:"text", text:`Analiza esta delivery note/factura y extrae en JSON (sin markdown):
{"marca":"fabricante o null","items":[{"codigo_producto":"part number exacto","descripcion":"descripción","cantidad":N,"numeros_serie":[],"numero_lote":"lote o null"}]}
REGLAS: seriales SN:A065|A070 → ["A065","A070"]. Sin seriales individuales → numero_lote. Accesorios sin nada → numeros_serie:[],numero_lote:null. Para BarrierTechnologies: omite seriales BT... y códigos MON-P. Responde SOLO JSON.` }
      ]}], "Extrae datos de documentos logísticos. Solo JSON válido.");
      setParsed(JSON.parse(text.replace(/```json|```/g,"").trim()));
    } catch { showToast("Error al procesar imagen","error"); }
    setParsing(false);
  };

  const confirmParsed = () => {
    const parts = commitEntry(parsed.marca, parsed.items||[]);
    if (parts) setPrintQueue(parts);
    setParsed(null); setImageData(null); setMode(null);
  };

  const confirmManual = () => {
    const serials = form.seriales ? form.seriales.split(",").map(s=>s.trim()).filter(Boolean) : ["SIN-SERIAL"];
    const items = [{ codigo_producto:form.codigo, descripcion:form.descripcion, cantidad:serials.length, numeros_serie:serials, numero_lote:form.lote||null }];
    const parts = commitEntry(form.marca, items);
    if (parts) setPrintQueue(parts);
    setForm({marca:"",codigo:"",descripcion:"",seriales:"",lote:""}); setMode(null);
  };

  const confirmImport = () => {
    try {
      const data = JSON.parse(importText.replace(/```json|```/g,"").trim());
      let items;
      if (data.products) {
        items = data.products.map(p=>({ codigo_producto:p.codigo, descripcion:p.descripcion, cantidad:1, numeros_serie:[p.serial], numero_lote:null }));
      } else { items = data.items; }
      const parts = commitEntry(data.marca||"", items);
      if (parts) setPrintQueue(parts);
      setImportText(""); setMode(null);
    } catch { showToast("JSON inválido","error"); }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {showCamera && <PhotoCapture onCapture={img=>{ setImageData(img); setMode("photo"); setShowCamera(false); parseImage(img); }} onClose={()=>setShowCamera(false)} />}

      <div><h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700 }}>Registrar Entrada</h2>
        <p style={{ margin:0, color:"#64748b", fontSize:14 }}>Foto de delivery note, importar JSON de Claude, o captura manual</p></div>

      {!mode && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {[{icon:"📷",title:"Foto",desc:"Toma foto con la cámara",key:"cam"},{icon:"📋",title:"Importar JSON",desc:"Pega el código de Claude",key:"import"},{icon:"✏️",title:"Manual",desc:"Ingresa los datos",key:"manual"}].map(opt=>(
            <Card key={opt.key} style={{ textAlign:"center", cursor:"pointer" }}>
              <button onClick={()=>opt.key==="cam"?setShowCamera(true):setMode(opt.key)} style={{ background:"none", border:"none", cursor:"pointer", width:"100%", padding:14 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>{opt.icon}</div>
                <div style={{ fontWeight:700, fontSize:13 }}>{opt.title}</div>
                <div style={{ color:"#94a3b8", fontSize:11, marginTop:3 }}>{opt.desc}</div>
              </button>
            </Card>
          ))}
        </div>
      )}

      {mode==="photo" && imageData && (
        <Card>
          <Btn variant="outline" small onClick={()=>{setMode(null);setImageData(null);setParsed(null);}} style={{marginBottom:12}}>← Volver</Btn>
          <img src={imageData} alt="dn" style={{ width:"100%", borderRadius:8, marginBottom:12, maxHeight:260, objectFit:"contain", background:"#f8fafc" }} />
          {parsing && <div style={{ color:"#64748b", fontSize:13 }}>⏳ Analizando con IA...</div>}
          {parsed && (
            <div style={{ marginTop:12 }}>
              <div style={{ fontWeight:700, color:"#16a34a", marginBottom:8 }}>✓ Datos extraídos</div>
              {parsed.marca ? <Badge color="#000" text="#fff">{parsed.marca}</Badge> : <Badge color="#fee2e2" text="#dc2626">Marca no detectada</Badge>}
              {isBarrier(parsed.marca) && <div style={{ marginTop:8, background:"#fef9c3", border:"1px solid #fde68a", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#854d0e" }}>🧩 Partes Barrier → irán a staging para armar kits</div>}
              <div style={{ marginTop:10 }}>
                {parsed.items?.map((item,i)=>(
                  <Card key={i} style={{ marginBottom:8, background:"#f8fafc" }}>
                    <div style={{ fontWeight:700 }}>{item.codigo_producto}</div>
                    <div style={{ color:"#64748b", fontSize:12, marginBottom:6 }}>{item.descripcion}</div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      <Badge>{item.cantidad} uds</Badge>
                      {item.numeros_serie?.map(sn=><Badge key={sn} color="#f0fdf4" text="#15803d">SN:{sn}</Badge>)}
                      {item.numero_lote&&<Badge color="#fef9c3" text="#854d0e">Lote:{item.numero_lote}</Badge>}
                    </div>
                  </Card>
                ))}
              </div>
              <div style={{ display:"flex", gap:10, marginTop:12 }}>
                <Btn onClick={confirmParsed}>✓ Confirmar y registrar</Btn>
                <Btn variant="secondary" onClick={()=>{setParsed(null);setImageData(null);setMode(null);}}>Repetir</Btn>
              </div>
            </div>
          )}
        </Card>
      )}

      {mode==="import" && (
        <Card>
          <Btn variant="outline" small onClick={()=>setMode(null)} style={{marginBottom:12}}>← Volver</Btn>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:6 }}>Pega el JSON generado por Claude</div>
          <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder='{"marca":"Fehling","items":[...]}' style={{ width:"100%", minHeight:140, border:"1.5px solid #e2e8f0", borderRadius:8, padding:12, fontSize:13, fontFamily:"monospace", resize:"vertical", boxSizing:"border-box", background:"#fafafa" }} />
          <Btn onClick={confirmImport} disabled={!importText.trim()} style={{marginTop:10}}>📥 Importar</Btn>
        </Card>
      )}

      {mode==="manual" && (
        <Card>
          <Btn variant="outline" small onClick={()=>setMode(null)} style={{marginBottom:12}}>← Volver</Btn>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Input label="Marca" value={form.marca} onChange={e=>setForm(f=>({...f,marca:e.target.value}))} placeholder="Fehling, Sutter, Autotissue..." />
              <Input label="Código de Producto" value={form.codigo} onChange={e=>setForm(f=>({...f,codigo:e.target.value}))} placeholder="MHD-7, 780198SGS..." />
            </div>
            {isBarrier(form.marca) && <div style={{ background:"#fef9c3", border:"1px solid #fde68a", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#854d0e" }}>🧩 Partes Barrier → irán a staging para armar kits</div>}
            <Input label="Descripción" value={form.descripcion} onChange={e=>setForm(f=>({...f,descripcion:e.target.value}))} />
            <Input label="Números de Serie (separados por coma)" value={form.seriales} onChange={e=>setForm(f=>({...f,seriales:e.target.value}))} placeholder="A065, A070" />
            <Input label="Número de Lote (si no hay seriales individuales)" value={form.lote} onChange={e=>setForm(f=>({...f,lote:e.target.value}))} placeholder="26029955" />
            <Btn onClick={confirmManual} disabled={!form.marca||!form.codigo}>✓ Registrar</Btn>
          </div>
        </Card>
      )}

      {/* Print Modal */}
      <Modal open={!!printQueue} onClose={()=>setPrintQueue(null)} title="🏷️ Etiquetas listas para imprimir">
        <div style={{ color:"#64748b", fontSize:13, marginBottom:14 }}>Formato 50×30mm — código, serial y QR</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          {printQueue?.map((p,i)=>(
            <div key={i} style={{ border:"1px solid #e2e8f0", borderRadius:8, padding:10, display:"flex", alignItems:"center", gap:8 }}>
              <QRCanvas text={p.qr_data} size={56} />
              <div style={{ overflow:"hidden" }}>
                <div style={{ fontWeight:700, fontSize:11, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.codigo}</div>
                <div style={{ fontSize:10, color:"#64748b", fontFamily:"monospace" }}>SN:{p.serial}</div>
              </div>
            </div>
          ))}
        </div>
        <PrintButton items={printQueue} />
      </Modal>
    </div>
  );
}

// ─── SALIDA TAB ───────────────────────────────────────────────────────────────
function SalidaTab({ store, setStore, showToast }) {
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
      const kit = (store.kits||[]).find(k=>k.qr_data===val&&k.status==="en_stock");
      if (kit) setFound({...kit, isKit:true});
      else setNotFound(true);
      return;
    }
    if (!val.includes("COD:")||!val.includes("SN:")) { if(val.length>3) setNotFound(true); return; }
    const codigo = val.match(/COD:([^|]+)/)?.[1]?.trim();
    const serial = val.match(/SN:(.+)/)?.[1]?.trim();
    if (!codigo||!serial) { setNotFound(true); return; }
    const p = store.products.find(p=>p.status==="en_stock"&&p.codigo===codigo&&p.serial===serial);
    if (p) setFound(p); else setNotFound(true);
  };

  const confirmSale = () => {
    if (!found) return;
    const now = new Date().toISOString();
    if (found.isKit) {
      setStore(prev=>({
        ...prev,
        kits:(prev.kits||[]).map(k=>k.id===found.id?{...k,status:"vendido",fecha_salida:now}:k),
        movements:[...prev.movements,{tipo:"salida",fecha:now,marca:"BarrierTechnologies",items:found.parts?.map(p=>({codigo:p.codigo,serial:p.serial}))||[],total:found.parts?.length||0,nota:`Kit vendido: ${found.name}`}]
      }));
    } else {
      setStore(prev=>({
        ...prev,
        products:prev.products.map(p=>p.id===found.id?{...p,status:"vendido",fecha_salida:now}:p),
        movements:[...prev.movements,{tipo:"salida",fecha:now,marca:found.marca,items:[{codigo:found.codigo,serial:found.serial}],total:1}]
      }));
    }
    setLastSold(found); setConfirmed(true);
    showToast(`✓ Salida: ${found.isKit?found.name:found.codigo}`);
  };

  const reset = () => { setInput(""); setFound(null); setNotFound(false); setConfirmed(false); setLastSold(null); };

  return (
    <>
      {scanning && <QRScanner onScan={v=>{setScanning(false);doSearch(v);}} onClose={()=>setScanning(false)} />}
      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <div><h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700 }}>Registrar Salida</h2>
          <p style={{ margin:0, color:"#64748b", fontSize:14 }}>Escanea el QR del producto con la cámara</p></div>
        <Card>
          <button onClick={()=>{reset();setScanning(true);}} style={{ width:"100%", padding:"18px 16px", border:"2px solid #000", borderRadius:0, background:"#000", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:6, fontFamily:"inherit", marginBottom:14 }}>
            <span style={{ fontSize:34 }}>📷</span>
            <span style={{ fontWeight:600, fontSize:14, color:"#fff", letterSpacing:1 }}>ESCANEAR QR</span>
            <span style={{ fontSize:11, color:"#999" }}>Toca para abrir el escáner</span>
          </button>
          <div style={{ borderTop:"1px solid #f1f5f9", paddingTop:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", marginBottom:6, textTransform:"uppercase", letterSpacing:.5 }}>O ingresa manualmente</div>
            <Input value={input} onChange={e=>doSearch(e.target.value)} placeholder="COD:MHD-7|SN:A065  ·  KIT:id" />
            <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>Formato: COD:xxx|SN:yyy — el serial solo no es válido</div>
          </div>
        </Card>

        {found && !confirmed && (
          <Card style={{ background:"#f0fdf4", border:"1.5px solid #86efac" }}>
            <div style={{ fontWeight:700, color:"#16a34a", marginBottom:10 }}>{found.isKit?"🧩 Kit identificado":"✓ Producto identificado"}</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontSize:14 }}>
              <div><span style={{ color:"#64748b" }}>Marca:</span> <strong>{found.marca}</strong></div>
              <div><span style={{ color:"#64748b" }}>{found.isKit?"Nombre:":"Código:"}</span> <strong>{found.isKit?found.name:found.codigo}</strong></div>
              {found.isKit ? (
                <div style={{ gridColumn:"1/-1" }}>
                  <span style={{ color:"#64748b" }}>Partes:</span>{" "}
                  {found.parts?.map(p=><span key={p.id} style={{ fontSize:12, background:"#f1f5f9", borderRadius:4, padding:"1px 6px", marginRight:4, fontFamily:"monospace" }}>{p.serial}</span>)}
                </div>
              ) : (
                <>
                  <div style={{ gridColumn:"1/-1" }}><span style={{ color:"#64748b" }}>Descripción:</span> {found.descripcion}</div>
                  <div><span style={{ color:"#64748b" }}>Serial:</span> <strong style={{ fontFamily:"monospace" }}>{found.serial}</strong></div>
                  <div><span style={{ color:"#64748b" }}>Entrada:</span> {new Date(found.fecha_entrada).toLocaleDateString("es-MX")}</div>
                </>
              )}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:14 }}>
              <Btn onClick={confirmSale}>📤 Confirmar salida</Btn>
              <Btn variant="secondary" onClick={reset}>Cancelar</Btn>
            </div>
          </Card>
        )}

        {confirmed && lastSold && (
          <Card style={{ background:"#f8fafc", border:"1.5px solid #000", textAlign:"center", padding:28 }}>
            <div style={{ fontSize:38, marginBottom:10 }}>✅</div>
            <div style={{ fontWeight:700, fontSize:16 }}>Salida registrada</div>
            <div style={{ color:"#475569", fontSize:13, marginTop:4 }}>{lastSold.isKit?lastSold.name:`${lastSold.codigo} · SN:${lastSold.serial}`}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center", marginTop:14 }}>
              <Btn onClick={()=>{reset();setScanning(true);}}>📷 Escanear otro</Btn>
              <Btn variant="outline" onClick={reset}>Listo</Btn>
            </div>
          </Card>
        )}

        {notFound && (
          <Card style={{ background:"#fef2f2", border:"1.5px solid #fca5a5" }}>
            <div style={{ fontWeight:600, color:"#dc2626", marginBottom:6 }}>⚠ Producto no encontrado</div>
            <div style={{ color:"#64748b", fontSize:13 }}>El QR escaneado no corresponde a ningún producto en stock. Verifica que el producto haya sido registrado.</div>
          </Card>
        )}
      </div>
    </>
  );
}

// ─── INVENTARIO TAB ───────────────────────────────────────────────────────────
function InventarioTab({ store, setStore, showToast }) {
  const [filter, setFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("en_stock");
  const [qrModal, setQrModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [bulkPreview, setBulkPreview] = useState([]);

  const brands = ["all", ...new Set(store.products.map(p=>p.marca).filter(Boolean))];
  const knownBrands = [...new Set(store.products.map(p=>p.marca).filter(Boolean))].sort();
  const filtered = store.products.filter(p=>
    (brandFilter==="all"||p.marca===brandFilter) &&
    (statusFilter==="all"||p.status===statusFilter) &&
    (!filter||[p.codigo,p.serial,p.descripcion,p.marca].some(v=>v?.toLowerCase().includes(filter.toLowerCase())))
  );
  const kitsInStock = (store.kits||[]).filter(k=>k.status==="en_stock");
  const stats = { total:store.products.length+(store.kits||[]).length, en_stock:store.products.filter(p=>p.status==="en_stock").length+kitsInStock.length, vendido:store.products.filter(p=>p.status==="vendido").length+(store.kits||[]).filter(k=>k.status==="vendido").length };

  const openEditSingle = p => { setEditModal({mode:"single",product:p}); setEditValue(p.marca||""); };
  const openEditBulk = p => { const aff=store.products.filter(x=>x.codigo===p.codigo); setBulkPreview(aff); setEditModal({mode:"bulk",codigo:p.codigo}); setEditValue(p.marca||""); };
  const confirmEdit = () => {
    const marca = editValue.trim(); if(!marca) return;
    setStore(prev=>({...prev,products:prev.products.map(p=>{
      if(editModal.mode==="single") return p.id===editModal.product.id?{...p,marca}:p;
      if(editModal.mode==="bulk") return p.codigo===editModal.codigo?{...p,marca}:p;
      return p;
    })}));
    showToast(`✓ Marca → "${marca}"`);
    setEditModal(null); setEditValue(""); setBulkPreview([]);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <h2 style={{ margin:0, fontSize:20, fontWeight:700 }}>Inventario</h2>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
        {[{label:"Total",value:stats.total,color:"#000",text:"#fff"},{label:"En stock",value:stats.en_stock,color:"#dcfce7",text:"#16a34a"},{label:"Vendidos",value:stats.vendido,color:"#fef9c3",text:"#854d0e"}].map((s,i)=>(
          <Card key={i} style={{ textAlign:"center", background:s.color, padding:"14px 10px" }}>
            <div style={{ fontSize:28, fontWeight:800, color:s.text }}>{s.value}</div>
            <div style={{ fontSize:11, color:s.text, opacity:.75 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Kits in inventory */}
      {kitsInStock.length>0 && (
        <Card style={{ background:"#f0fdf4", border:"1.5px solid #86efac" }}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>🧩 Kits Barrier en stock ({kitsInStock.length})</div>
          {kitsInStock.map(k=>(
            <div key={k.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, padding:"8px 0", borderBottom:"1px solid #bbf7d0" }}>
              <QRCanvas text={k.qr_data} size={44} />
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:13 }}>{k.name}</div>
                <div style={{ fontSize:11, color:"#64748b" }}>{k.parts?.map(p=>p.serial).join(" · ")}</div>
              </div>
              <Btn small onClick={()=>printLabels([{...k,isKit:true,codigo:k.name}])}>🖨️</Btn>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Input placeholder="Buscar código, serial, descripción..." value={filter} onChange={e=>setFilter(e.target.value)} style={{flex:1,minWidth:160}} />
          <select value={brandFilter} onChange={e=>setBrandFilter(e.target.value)} style={{ border:"1.5px solid #e2e8f0", borderRadius:8, padding:"8px 10px", fontFamily:"inherit", fontSize:13 }}>
            {brands.map(b=><option key={b} value={b}>{b==="all"?"Todas las marcas":b||"(sin marca)"}</option>)}
          </select>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{ border:"1.5px solid #e2e8f0", borderRadius:8, padding:"8px 10px", fontFamily:"inherit", fontSize:13 }}>
            <option value="all">Todos</option><option value="en_stock">En stock</option><option value="vendido">Vendidos</option>
          </select>
        </div>
      </Card>

      <Card style={{ padding:0, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
              {["Marca","Código","Descripción","Serial","Estado","Entrada","Acciones"].map(h=>(
                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#64748b", fontSize:11, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.length===0 && <tr><td colSpan={7} style={{ padding:28, textAlign:"center", color:"#94a3b8" }}>Sin resultados</td></tr>}
              {filtered.map((p,i)=>(
                <tr key={p.id} style={{ borderBottom:"1px solid #f1f5f9", background:i%2===0?"#fff":"#fafafa" }}>
                  <td style={{ padding:"9px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      {p.marca?<Badge color="#000" text="#fff">{p.marca}</Badge>:<Badge color="#fee2e2" text="#dc2626">Sin marca</Badge>}
                      <button onClick={()=>openEditSingle(p)} title="Editar marca" style={{ background:"none",border:"none",cursor:"pointer",fontSize:12,opacity:.5,padding:1 }}>✏️</button>
                    </div>
                  </td>
                  <td style={{ padding:"9px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ fontWeight:700 }}>{p.codigo}</span>
                      <button onClick={()=>openEditBulk(p)} title="Editar marca de todas las unidades" style={{ background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#94a3b8",padding:1 }}>↕</button>
                    </div>
                  </td>
                  <td style={{ padding:"9px 12px", color:"#475569", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={p.descripcion}>{p.descripcion}</td>
                  <td style={{ padding:"9px 12px", fontFamily:"monospace", fontSize:11 }}>{p.serial}</td>
                  <td style={{ padding:"9px 12px" }}><Badge color={p.status==="en_stock"?"#dcfce7":"#fef9c3"} text={p.status==="en_stock"?"#16a34a":"#854d0e"}>{p.status==="en_stock"?"En stock":"Vendido"}</Badge></td>
                  <td style={{ padding:"9px 12px", color:"#64748b", fontSize:11, whiteSpace:"nowrap" }}>{new Date(p.fecha_entrada).toLocaleDateString("es-MX")}</td>
                  <td style={{ padding:"9px 12px" }}><Btn small variant="outline" onClick={()=>setQrModal(p)}>Ver QR</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!qrModal} onClose={()=>setQrModal(null)} title="Vista previa de etiqueta">
        {qrModal && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
            {/* Label preview — exact 50×30mm proportions */}
            <div style={{ width:280, height:168, border:"1.5px solid #000", display:"flex", borderRadius:4, overflow:"hidden", boxShadow:"0 4px 16px rgba(0,0,0,.12)" }}>
              {/* Left: info */}
              <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", padding:"10px 10px 10px 14px", borderRight:"1px solid #000" }}>
                <div style={{ fontSize:8, color:"#999", letterSpacing:2, textTransform:"uppercase", marginBottom:6 }}>MKJ TRADE</div>
                <div style={{ fontSize:16, fontWeight:800, color:"#000", lineHeight:1.2, wordBreak:"break-all" }}>{qrModal.codigo}</div>
                <div style={{ fontSize:12, color:"#333", fontFamily:"monospace", marginTop:6, wordBreak:"break-all" }}>SN: {qrModal.serial}</div>
              </div>
              {/* Right: QR */}
              <div style={{ width:140, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", padding:8 }}>
                <QRCanvas text={qrModal.qr_data} size={112} />
              </div>
            </div>
            <div style={{ color:"#94a3b8", fontSize:11, fontFamily:"monospace" }}>{qrModal.qr_data}</div>
            <Btn onClick={()=>printLabels([qrModal])}>🖨️ Imprimir etiqueta 50×30mm</Btn>
          </div>
        )}
      </Modal>

      <Modal open={!!editModal} onClose={()=>{setEditModal(null);setEditValue("");setBulkPreview([]);}} title={editModal?.mode==="bulk"?`Editar marca — todas las unidades de ${editModal?.codigo}`:`Editar marca — ${editModal?.product?.codigo}`}>
        {editModal && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {editModal.mode==="bulk" && (
              <div style={{ background:"#fef9c3", border:"1px solid #fde68a", borderRadius:8, padding:12, fontSize:13, color:"#854d0e" }}>
                ⚠ Actualizará <strong>{bulkPreview.length} unidades</strong> con código <strong>{editModal.codigo}</strong>
              </div>
            )}
            <Input label="Nueva marca" value={editValue} onChange={e=>setEditValue(e.target.value)} placeholder="Autotissue, Fehling, Sutter..." />
            {knownBrands.length>0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {knownBrands.map(b=><button key={b} onClick={()=>setEditValue(b)} style={{ background:editValue===b?"#000":"#f1f5f9", color:editValue===b?"#fff":"#0f172a", border:"none", borderRadius:6, padding:"4px 12px", fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>{b}</button>)}
              </div>
            )}
            <div style={{ display:"flex", gap:10 }}>
              <Btn onClick={confirmEdit} disabled={!editValue.trim()}>✓ Guardar</Btn>
              <Btn variant="secondary" onClick={()=>{setEditModal(null);setEditValue("");setBulkPreview([]);}}>Cancelar</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── KITS TAB (Barrier) ───────────────────────────────────────────────────────
function KitsTab({ store, setStore, showToast }) {
  const [selected, setSelected] = useState([]);
  const [kitName, setKitName] = useState("");
  const [printKit, setPrintKit] = useState(null);
  const [expandedKit, setExpandedKit] = useState(null);

  const staging = store.barrierStaging || [];
  const kits = store.kits || [];

  const toggle = id => setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id]);
  const selectAll = () => setSelected(staging.map(p=>p.id));
  const clearSel = () => setSelected([]);

  const partType = serial => {
    if (!serial) return { label:"Accesorio", icon:"📦", color:"#f1f5f9", text:"#475569" };
    if (serial.startsWith("A")) return { label:"Mandil", icon:"🥼", color:"#dbeafe", text:"#1d4ed8" };
    if (serial.startsWith("T")) return { label:"Tiroideo", icon:"🛡️", color:"#f0fdf4", text:"#16a34a" };
    return { label:"Accesorio", icon:"📦", color:"#fef9c3", text:"#854d0e" };
  };

  const createKit = () => {
    if (selected.length < 1) { showToast("Selecciona al menos una parte","error"); return; }
    const kitId = makeId();
    const selectedParts = staging.filter(p=>selected.includes(p.id));
    const name = kitName.trim() || `Kit Barrier ${kits.length+1}`;
    const newKit = {
      id: kitId, name, marca:"BarrierTechnologies",
      partIds: selected,
      parts: selectedParts.map(p=>({ id:p.id, codigo:p.codigo, serial:p.serial, descripcion:p.descripcion })),
      qr_data: `KIT:${kitId}`,
      status:"en_stock",
      fecha_creacion: new Date().toISOString(),
      fecha_salida: null,
    };
    setStore(prev => ({
      ...prev,
      barrierStaging: prev.barrierStaging.filter(p=>!selected.includes(p.id)),
      kits: [...(prev.kits||[]), newKit],
      movements: [...prev.movements, { tipo:"kit_creado", fecha:new Date().toISOString(), marca:"BarrierTechnologies", items:selectedParts.map(p=>({codigo:p.codigo,serial:p.serial})), total:selectedParts.length, nota:`Kit creado: ${name}` }]
    }));
    setSelected([]); setKitName("");
    setPrintKit(newKit);
    showToast(`✓ Kit "${name}" creado — listo en inventario`);
  };

  const dissolveKit = kit => {
    setStore(prev => ({
      ...prev,
      barrierStaging: [...prev.barrierStaging, ...kit.parts.map(p=>({ ...p, id:p.id, marca:"BarrierTechnologies", qr_data:`COD:${p.codigo}|SN:${p.serial}`, status:"en_stock", fecha_entrada:new Date().toISOString(), fecha_salida:null }))],
      kits: prev.kits.filter(k=>k.id!==kit.id),
      movements: [...prev.movements, { tipo:"kit_disuelto", fecha:new Date().toISOString(), marca:"BarrierTechnologies", items:kit.parts.map(p=>({codigo:p.codigo,serial:p.serial})), total:kit.parts.length, nota:`Kit disuelto: ${kit.name}` }]
    }));
    showToast(`Kit "${kit.name}" disuelto — partes de vuelta a staging`);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div>
        <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700 }}>Kits — Barrier Technologies</h2>
        <p style={{ margin:0, color:"#64748b", fontSize:14 }}>Asocia partes para formar kits con QR único que va al inventario</p>
      </div>

      {/* Staging area */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div style={{ fontWeight:700, fontSize:15 }}>🗂️ Partes disponibles en staging ({staging.length})</div>
          {staging.length>0 && (
            <div style={{ display:"flex", gap:6 }}>
              <Btn small variant="secondary" onClick={selectAll}>Seleccionar todo</Btn>
              {selected.length>0 && <Btn small variant="outline" onClick={clearSel}>Limpiar</Btn>}
            </div>
          )}
        </div>

        {staging.length===0 ? (
          <div style={{ textAlign:"center", padding:"28px 0", color:"#94a3b8" }}>
            <div style={{ fontSize:36, marginBottom:8 }}>📭</div>
            <div style={{ fontSize:14 }}>No hay partes en staging</div>
            <div style={{ fontSize:12, marginTop:4 }}>Registra una entrada de Barrier para comenzar</div>
          </div>
        ) : (
          <>
            {/* Group by type */}
            {[{prefix:"A",label:"🥼 Mandiles"},{prefix:"T",label:"🛡️ Tiroides"},{prefix:null,label:"📦 Otros"}].map(group=>{
              const gparts = staging.filter(p=>group.prefix ? p.serial?.startsWith(group.prefix) : !p.serial?.startsWith("A")&&!p.serial?.startsWith("T"));
              if(gparts.length===0) return null;
              return (
                <div key={group.label} style={{ marginBottom:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:8, textTransform:"uppercase", letterSpacing:.5 }}>{group.label} ({gparts.length})</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:8 }}>
                    {gparts.map(p=>{
                      const sel = selected.includes(p.id);
                      const pt = partType(p.serial);
                      return (
                        <button key={p.id} onClick={()=>toggle(p.id)} style={{ border:sel?"2px solid #000":"1.5px solid #e2e8f0", background:sel?"#000":pt.color, color:sel?"#fff":pt.text, borderRadius:8, padding:"10px 12px", cursor:"pointer", textAlign:"left", fontFamily:"inherit", transition:"all .12s" }}>
                          <div style={{ fontSize:11, opacity:.7, marginBottom:3 }}>{pt.icon} {pt.label}</div>
                          <div style={{ fontWeight:700, fontSize:13 }}>{p.codigo}</div>
                          <div style={{ fontFamily:"monospace", fontSize:11, opacity:.85, marginTop:2 }}>SN: {p.serial}</div>
                          <div style={{ fontSize:10, opacity:.6, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.descripcion}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Kit builder */}
            <div style={{ borderTop:"1.5px solid #e2e8f0", paddingTop:14, marginTop:4 }}>
              <div style={{ display:"flex", gap:10, alignItems:"flex-end", flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:160 }}>
                  <Input label={`Nombre del kit — ${selected.length} partes seleccionadas`} value={kitName} onChange={e=>setKitName(e.target.value)} placeholder={`Kit Barrier ${kits.length+1}`} />
                </div>
                <Btn onClick={createKit} disabled={selected.length<1}>
                  🧩 Crear kit y enviar a inventario
                </Btn>
              </div>
              {selected.length>0 && (
                <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:5 }}>
                  {staging.filter(p=>selected.includes(p.id)).map(p=>(
                    <span key={p.id} style={{ fontSize:11, background:"#000", color:"#fff", borderRadius:5, padding:"2px 8px", fontFamily:"monospace" }}>{partType(p.serial).icon} {p.serial}</span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Existing kits */}
      {kits.length>0 && (
        <div>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>Kits en inventario ({kits.filter(k=>k.status==="en_stock").length} en stock)</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {kits.map(kit=>(
              <Card key={kit.id} style={{ border:kit.status==="en_stock"?"1.5px solid #000":"1px solid #e2e8f0", opacity:kit.status==="vendido"?.6:1 }}>
                <div style={{ display:"flex", gap:14 }}>
                  <div style={{ flexShrink:0, cursor:"pointer" }} onClick={()=>setPrintKit(kit)}><QRCanvas text={kit.qr_data} size={68} /></div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:6 }}>
                      <span style={{ fontWeight:700, fontSize:15 }}>{kit.name}</span>
                      <Badge color={kit.status==="en_stock"?"#000":"#fef9c3"} text={kit.status==="en_stock"?"#fff":"#854d0e"}>{kit.status==="en_stock"?"En stock":"Vendido"}</Badge>
                      <span style={{ fontSize:11, color:"#94a3b8" }}>{kit.parts.length} partes · {new Date(kit.fecha_creacion).toLocaleDateString("es-MX")}</span>
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:10, cursor:"pointer" }} onClick={()=>setExpandedKit(expandedKit===kit.id?null:kit.id)}>
                      {kit.parts.map(p=><span key={p.id} style={{ fontSize:11, background:"#f1f5f9", borderRadius:5, padding:"2px 8px", fontFamily:"monospace" }}>{partType(p.serial).icon} SN:{p.serial}</span>)}
                    </div>
                    {expandedKit===kit.id && (
                      <div style={{ background:"#f8fafc", borderRadius:8, padding:10, marginBottom:10 }}>
                        {kit.parts.map(p=><div key={p.id} style={{ fontSize:12, color:"#475569", marginBottom:3 }}><strong>{p.codigo}</strong> · SN:{p.serial} · <span style={{ color:"#94a3b8" }}>{p.descripcion}</span></div>)}
                      </div>
                    )}
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <Btn small onClick={()=>setPrintKit(kit)}>🖨️ Imprimir QR</Btn>
                      {kit.status==="en_stock" && <Btn small variant="outline" onClick={()=>dissolveKit(kit)}>↩ Disolver</Btn>}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Print kit modal */}
      <Modal open={!!printKit} onClose={()=>setPrintKit(null)} title={`QR del kit — ${printKit?.name}`}>
        {printKit && (
          <div style={{ textAlign:"center" }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:8 }}><QRCanvas text={printKit.qr_data} size={200} /></div>
            <div style={{ fontWeight:700, fontSize:16, marginTop:8 }}>{printKit.name}</div>
            <div style={{ color:"#64748b", fontSize:11, fontFamily:"monospace", marginTop:4 }}>{printKit.qr_data}</div>
            <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", justifyContent:"center", gap:5 }}>
              {printKit.parts?.map(p=><span key={p.id} style={{ fontSize:11, background:"#f1f5f9", borderRadius:5, padding:"2px 8px", fontFamily:"monospace" }}>{partType(p.serial).icon} {p.serial}</span>)}
            </div>
            <PrintButton items={[{...printKit,isKit:true,codigo:printKit.name,serial:printKit.parts?.map(p=>p.serial).join("+")}]} />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── HISTORIAL TAB ────────────────────────────────────────────────────────────
function HistorialTab({ store }) {
  const sorted = [...store.movements].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  const typeLabel = { entrada:"Entrada", salida:"Salida", entrada_barrier_staging:"Entrada Barrier", kit_creado:"Kit creado", kit_disuelto:"Kit disuelto" };
  const typeColor = { entrada:{bg:"#dcfce7",text:"#16a34a"}, salida:{bg:"#fef9c3",text:"#854d0e"}, entrada_barrier_staging:{bg:"#dbeafe",text:"#1d4ed8"}, kit_creado:{bg:"#f0fdf4",text:"#166534"}, kit_disuelto:{bg:"#fee2e2",text:"#dc2626"} };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div><h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700 }}>Historial</h2>
        <p style={{ margin:0, color:"#64748b", fontSize:14 }}>{sorted.length} movimientos</p></div>
      {sorted.length===0 && <Card style={{ textAlign:"center", padding:40, color:"#94a3b8" }}><div style={{ fontSize:36, marginBottom:8 }}>📋</div>Sin movimientos aún</Card>}
      {sorted.map((m,i)=>{
        const c = typeColor[m.tipo]||{bg:"#f1f5f9",text:"#64748b"};
        return (
          <Card key={i}>
            <div style={{ display:"flex", gap:12 }}>
              <div style={{ width:40, height:40, borderRadius:10, flexShrink:0, background:c.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>
                {m.tipo==="entrada"?"📥":m.tipo==="salida"?"📤":m.tipo==="kit_creado"?"🧩":m.tipo==="entrada_barrier_staging"?"🗂️":"↩"}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", marginBottom:4 }}>
                  <Badge color={c.bg} text={c.text}>{typeLabel[m.tipo]||m.tipo}</Badge>
                  <Badge color="#000" text="#fff">{m.marca}</Badge>
                  <span style={{ fontSize:11, color:"#94a3b8" }}>{new Date(m.fecha).toLocaleString("es-MX")}</span>
                </div>
                {m.nota && <div style={{ fontSize:11, color:"#64748b", fontStyle:"italic", marginBottom:4 }}>{m.nota}</div>}
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                  {m.items?.slice(0,10).map((item,j)=><span key={j} style={{ fontSize:10, background:"#f1f5f9", borderRadius:4, padding:"1px 7px", fontFamily:"monospace" }}>{item.codigo}·{item.serial}</span>)}
                  {m.items?.length>10 && <span style={{ fontSize:10, color:"#94a3b8" }}>+{m.items.length-10} más</span>}
                </div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:4 }}>{m.total} unidad{m.total!==1?"es":""}</div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
