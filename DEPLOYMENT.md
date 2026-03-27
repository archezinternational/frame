# FRAME — Guía de Implementación con Cloudflare
**Acceso automatizado vía Gumroad License Keys + Cloudflare Worker + Cloudflare Pages**

---

## Índice

1. [Visión general](#1-visión-general)
2. [Prerequisitos](#2-prerequisitos)
3. [Paso 1 — Gumroad: activar License Keys](#3-paso-1--gumroad-activar-license-keys)
4. [Paso 2 — Cloudflare Worker: validador de licencias](#4-paso-2--cloudflare-worker-validador-de-licencias)
5. [Paso 3 — Cloudflare KV: lista de bloqueo manual](#5-paso-3--cloudflare-kv-lista-de-bloqueo-manual)
6. [Paso 4 — FRAME: añadir la pantalla de acceso (gate)](#6-paso-4--frame-añadir-la-pantalla-de-acceso-gate)
7. [Paso 5 — Cloudflare Pages: publicar FRAME](#7-paso-5--cloudflare-pages-publicar-frame)
8. [Paso 6 — Dominio personalizado](#8-paso-6--dominio-personalizado)
9. [Revocar acceso a un usuario](#9-revocar-acceso-a-un-usuario)
10. [Pruebas y verificación](#10-pruebas-y-verificación)
11. [Mantenimiento y actualizaciones](#11-mantenimiento-y-actualizaciones)

---

## 1. Visión general

```
Instagram
   │
   ▼
Usuario llega a la página del producto en WordPress/Gumroad
   │
   ▼
Compra en Gumroad → recibe license key automáticamente por email
   │
   ▼
Entra a frame.archezinternational.com
   │
   ▼
Pantalla de acceso (gate) → ingresa su license key
   │
   ▼
Cloudflare Worker verifica la key contra la API de Gumroad
+ consulta la KV blocklist
   │
   ├─ ✅ Válida → acceso concedido (key guardada en localStorage)
   └─ ❌ Inválida / revocada → acceso bloqueado
```

**Características del sistema:**
- Activación 100% automática (sin trabajo manual por compra)
- Revocación por usuario en segundos desde Gumroad o desde Cloudflare KV
- Sin base de datos propia que mantener
- Costo: $0 (Gumroad gratis para esto, Cloudflare free tier)
- Re-validación en cada nueva sesión (las revocaciones se aplican inmediatamente)

---

## 2. Prerequisitos

| Herramienta | Requerido | Notas |
|---|---|---|
| Cuenta en [Gumroad](https://gumroad.com) | ✅ | Ya la tienen |
| Cuenta en [Cloudflare](https://cloudflare.com) | ✅ | Crear gratis |
| Repositorio Git del proyecto FRAME | ✅ | Ya creado |
| Node.js instalado localmente | Opcional | Solo para Wrangler CLI |
| Dominio archezinternational.com en Cloudflare | Recomendado | Para subdominio frame.* |

---

## 3. Paso 1 — Gumroad: activar License Keys

### 3.1 Habilitar license keys en el producto

1. Ir a **Gumroad Dashboard → Products → [tu producto Midjourney Guide]**
2. Clic en **Edit**
3. En la sección **Content**, activar el toggle **"Generate a unique license key"**
4. Guardar

A partir de ese momento, cada comprador recibe automáticamente un email con su license key única en formato:

```
XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX
```

### 3.2 Obtener el Gumroad API Key

1. Ir a **Gumroad → Settings → Advanced → Application**
2. Copiar el **Access Token**
3. Guardarlo de forma segura — lo usarás en el Worker

> ⚠️ **Nunca expongas este token en el frontend.** Solo vive en el Worker.

### 3.3 Obtener el Product Permalink

1. En el producto, copiar el **permalink** (la parte final de la URL, e.g. `mjguide`)
2. Lo necesitarás para filtrar que solo validen keys de ese producto específico

---

## 4. Paso 2 — Cloudflare Worker: validador de licencias

El Worker actúa como intermediario seguro entre FRAME y la API de Gumroad.

### 4.1 Crear el Worker

1. Ir a **Cloudflare Dashboard → Workers & Pages → Create Application → Create Worker**
2. Nombrar el Worker: `frame-license-validator`
3. Clic en **Deploy** (con el código placeholder)
4. Luego clic en **Edit code** y reemplazar con el siguiente código:

```javascript
// frame-license-validator — Cloudflare Worker
// Valida license keys de Gumroad y consulta blocklist en KV

export default {
  async fetch(request, env) {

    // Permitir CORS desde tu dominio
    const allowedOrigins = [
      'https://frame.archezinternational.com',
      'http://localhost:8080', // desarrollo local
    ];

    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ valid: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let licenseKey;
    try {
      const body = await request.json();
      licenseKey = (body.license_key || '').trim().toUpperCase();
    } catch {
      return new Response(JSON.stringify({ valid: false, error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!licenseKey) {
      return new Response(JSON.stringify({ valid: false, error: 'License key required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Consultar blocklist manual en KV (revocaciones inmediatas)
    const blocked = await env.FRAME_BLOCKLIST.get(licenseKey);
    if (blocked !== null) {
      return new Response(JSON.stringify({ valid: false, error: 'Access revoked' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Verificar contra la API de Gumroad
    const gumroadRes = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_permalink: env.GUMROAD_PRODUCT_PERMALINK,
        license_key: licenseKey,
        increment_uses_count: 'false', // no incrementar el contador cada vez que validan
      }),
    });

    const gumroadData = await gumroadRes.json();

    if (!gumroadData.success) {
      return new Response(JSON.stringify({ valid: false, error: 'Invalid license key' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Verificar que la compra no fue reembolsada o en dispute
    const purchase = gumroadData.purchase;
    if (purchase.refunded || purchase.disputed || purchase.chargebacked) {
      return new Response(JSON.stringify({ valid: false, error: 'Purchase refunded or disputed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ✅ Todo en orden
    return new Response(JSON.stringify({
      valid: true,
      email: purchase.email,   // opcional: para personalización futura
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
```

### 4.2 Configurar variables de entorno del Worker

En **Workers & Pages → frame-license-validator → Settings → Variables**:

| Variable | Valor | Tipo |
|---|---|---|
| `GUMROAD_PRODUCT_PERMALINK` | `mjguide` (tu permalink) | Text |
| `GUMROAD_ACCESS_TOKEN` | `tu_access_token_de_gumroad` | **Secret** ← importante |

> Las variables tipo **Secret** están encriptadas y nunca son visibles después de guardarlas.

### 4.3 Anotar la URL del Worker

Después de deployar, Cloudflare te da una URL como:
```
https://frame-license-validator.TU-SUBDOMINIO.workers.dev
```
Guárdala — la necesitarás en el gate screen de FRAME.

---

## 5. Paso 3 — Cloudflare KV: lista de bloqueo manual

El KV (Key-Value store) permite revocar acceso de forma instantánea sin tocar Gumroad.

### 5.1 Crear el namespace KV

1. Ir a **Cloudflare Dashboard → Workers & Pages → KV**
2. Clic en **Create a namespace**
3. Nombre: `FRAME_BLOCKLIST`
4. Clic en **Add**

### 5.2 Vincular el KV al Worker

1. Ir a **Workers → frame-license-validator → Settings → Bindings**
2. Clic en **Add binding → KV Namespace**
3. Variable name: `FRAME_BLOCKLIST`
4. KV Namespace: seleccionar `FRAME_BLOCKLIST`
5. Guardar y re-deployar

### 5.3 Cómo bloquear a un usuario (revocación manual)

Para bloquear una license key específica de forma **inmediata**:

**Opción A — Desde el dashboard de Cloudflare:**
1. Ir a **Workers & Pages → KV → FRAME_BLOCKLIST**
2. Clic en **View** → **Add entry**
3. Key: `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX` (la license key del usuario)
4. Value: `revoked` (o la razón: `refunded`, `abuse`, etc.)
5. Guardar → bloqueado en la próxima validación

**Opción B — Desde Gumroad (para también deshabilitar la key en Gumroad):**
1. Ir a **Gumroad → Customers**
2. Buscar la venta del usuario
3. Clic en la venta → **Disable license key**
4. El Worker detectará el estado en la siguiente validación de sesión

---

## 6. Paso 4 — FRAME: añadir la pantalla de acceso (gate)

Agregar el siguiente bloque al inicio del `<body>` en `index.html`, **antes** del `<header>`:

```html
<!-- ── GATE SCREEN ─────────────────────────────────────── -->
<div id="gate" style="
  position:fixed; inset:0; background:#fff; z-index:9999;
  display:flex; align-items:center; justify-content:center;
  font-family:'Montserrat',sans-serif;
">
  <div style="width:100%; max-width:440px; padding:40px 32px; text-align:center;">

    <div style="font-family:'Bebas Neue',sans-serif; font-size:32px; letter-spacing:0.18em; color:#f0c05a; margin-bottom:4px;">
      FRAME
    </div>
    <div style="font-size:10px; font-weight:600; letter-spacing:0.22em; text-transform:uppercase; color:#aaa; margin-bottom:36px;">
      by Archez International
    </div>

    <div style="font-size:15px; font-weight:700; color:#1a1a1a; margin-bottom:8px;">
      Enter your license key
    </div>
    <div style="font-size:12px; color:#777; margin-bottom:28px; line-height:1.6;">
      Find your key in the Gumroad receipt email<br>you received after purchase.
    </div>

    <input id="gateInput" type="text"
      placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
      style="
        width:100%; padding:13px 16px;
        border:1.5px solid #ddd; border-radius:8px;
        font-family:'Montserrat',sans-serif; font-size:13px;
        color:#1a1a1a; outline:none; text-align:center;
        letter-spacing:0.05em; margin-bottom:12px;
        transition:border-color 0.18s;
      "
      onkeydown="if(event.key==='Enter') unlockFRAME()"
      onfocus="this.style.borderColor='#f0c05a'"
      onblur="this.style.borderColor='#ddd'"
    />

    <button onclick="unlockFRAME()" id="gateBtn" style="
      width:100%; padding:13px; border-radius:8px;
      background:#1a1a1a; color:#fff; border:none;
      font-family:'Montserrat',sans-serif; font-size:11px;
      font-weight:700; letter-spacing:0.14em; text-transform:uppercase;
      cursor:pointer; transition:background 0.18s; margin-bottom:16px;
    ">
      Unlock FRAME
    </button>

    <div id="gateError" style="
      font-size:11px; color:#e05; display:none; margin-bottom:12px;
    "></div>

    <div style="font-size:11px; color:#bbb; line-height:1.6;">
      Don't have a license key?
      <a href="https://archezinternational.gumroad.com/l/mjguide"
        target="_blank"
        style="color:#f0c05a; text-decoration:none; font-weight:600;">
        Get the Midjourney Guide →
      </a>
    </div>
  </div>
</div>
<!-- ── END GATE ─────────────────────────────────────────── -->
```

Agregar el siguiente script al final del `<body>`, **antes** del script principal de FRAME:

```html
<script>
// ── FRAME GATE ──────────────────────────────────────────────────────────
const WORKER_URL = 'https://frame-license-validator.TU-SUBDOMINIO.workers.dev';
const STORAGE_KEY = 'frame_license';
const REVALIDATE_HOURS = 24; // re-validar cada 24h de inactividad

async function checkStoredLicense() {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!stored) return false;

  const hoursSince = (Date.now() - stored.ts) / 36e5;
  if (hoursSince < REVALIDATE_HOURS) {
    // Dentro del período de gracia → no re-validar
    return true;
  }

  // Re-validar contra el Worker
  return await validateKey(stored.key);
}

async function validateKey(key) {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });
    const data = await res.json();
    if (data.valid) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, ts: Date.now() }));
      return true;
    }
    localStorage.removeItem(STORAGE_KEY);
    return false;
  } catch {
    // Si el Worker falla por red, permitir acceso si hay key guardada (fail-open)
    return !!localStorage.getItem(STORAGE_KEY);
  }
}

async function unlockFRAME() {
  const key = document.getElementById('gateInput').value.trim();
  const btn = document.getElementById('gateBtn');
  const errEl = document.getElementById('gateError');

  if (!key) { showGateError('Please enter your license key.'); return; }

  btn.textContent = 'Validating…';
  btn.disabled = true;
  errEl.style.display = 'none';

  const valid = await validateKey(key);

  if (valid) {
    document.getElementById('gate').style.opacity = '0';
    document.getElementById('gate').style.transition = 'opacity 0.4s';
    setTimeout(() => document.getElementById('gate').remove(), 400);
  } else {
    btn.textContent = 'Unlock FRAME';
    btn.disabled = false;
    showGateError('Invalid or revoked license key. Check your Gumroad receipt and try again.');
  }
}

function showGateError(msg) {
  const el = document.getElementById('gateError');
  el.textContent = msg;
  el.style.display = 'block';
}

// Al cargar → verificar si ya tiene licencia válida almacenada
(async () => {
  const hasAccess = await checkStoredLicense();
  if (hasAccess) {
    document.getElementById('gate').remove();
  }
})();
// ────────────────────────────────────────────────────────────────────────
</script>
```

> **Recuerda:** reemplazar `TU-SUBDOMINIO` con el subdominio real de tu cuenta Cloudflare Workers.

---

## 7. Paso 5 — Cloudflare Pages: publicar FRAME

Cloudflare Pages despliega FRAME automáticamente cada vez que haces `git push`.

### 7.1 Conectar el repositorio

1. Ir a **Cloudflare Dashboard → Workers & Pages → Create Application → Pages**
2. Clic en **Connect to Git**
3. Conectar tu cuenta de GitHub/GitLab y seleccionar el repositorio de FRAME
4. Configuración del build:

| Campo | Valor |
|---|---|
| Framework preset | None |
| Build command | *(dejar vacío)* |
| Build output directory | `/` |
| Root directory | `/` |

5. Clic en **Save and Deploy**

Cloudflare Pages asignará una URL del tipo:
```
https://frame.pages.dev
```

### 7.2 Flujo de actualización continua

```bash
# Cualquier cambio futuro en FRAME:
git add index.html
git commit -m "feat: actualizar chips de Landscape Design"
git push

# → Cloudflare Pages detecta el push y re-despliega en ~30 segundos
# → No hay que hacer nada más
```

---

## 8. Paso 6 — Dominio personalizado

### 8.1 Subdominio en Cloudflare Pages

1. Ir a **Pages → FRAME → Custom Domains**
2. Clic en **Set up a custom domain**
3. Ingresar: `frame.archezinternational.com`
4. Cloudflare configura el DNS automáticamente si el dominio está en Cloudflare
5. Esperar ~2 minutos → SSL activado automáticamente

### 8.2 Si el dominio está en otro registrar

Agregar el siguiente registro DNS en tu registrar:

```
Type:  CNAME
Name:  frame
Value: frame.pages.dev
TTL:   Auto
```

---

## 9. Revocar acceso a un usuario

### Revocación vía Cloudflare KV (inmediata, recomendada)

```
Cloudflare Dashboard
→ Workers & Pages
→ KV
→ FRAME_BLOCKLIST
→ Add entry

Key:   XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX
Value: revoked
```

El usuario queda bloqueado en su **próxima sesión** (máximo 24h si está dentro del período de gracia).

Para bloqueo **instantáneo** (corta la sesión activa de inmediato): reducir `REVALIDATE_HOURS` a `0` en el gate script. Con `0`, el Worker se consulta en cada recarga de página.

### Revocación vía Gumroad

1. **Gumroad → Sales → [búsqueda por email]**
2. Abrir la venta → **Disable License Key**
3. El Worker detecta la key como inválida en la próxima validación

### Restaurar acceso

Para restaurar a un usuario bloqueado en KV:
```
KV → FRAME_BLOCKLIST → buscar la key → Delete entry
```

---

## 10. Pruebas y verificación

### Checklist antes de lanzar

```
□ License key habilitada en el producto de Gumroad
□ Worker deployado y respondiendo (probar con curl)
□ Variables GUMROAD_PRODUCT_PERMALINK y GUMROAD_ACCESS_TOKEN configuradas
□ KV FRAME_BLOCKLIST vinculado al Worker
□ Gate screen integrado en index.html con la URL correcta del Worker
□ Repo actualizado y Cloudflare Pages re-desplegado
□ Dominio frame.archezinternational.com activo con SSL
```

### Probar el Worker manualmente

```bash
# Desde terminal — probar key inválida
curl -X POST https://frame-license-validator.TU-SUBDOMINIO.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"license_key": "INVALID-KEY-0000-0000"}'

# Respuesta esperada:
# {"valid":false,"error":"Invalid license key"}

# Probar con una key real de una compra de prueba
curl -X POST https://frame-license-validator.TU-SUBDOMINIO.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"license_key": "TU-KEY-REAL-AQUI"}'

# Respuesta esperada:
# {"valid":true,"email":"comprador@email.com"}
```

### Simular revocación

1. Añadir una key válida al KV FRAME_BLOCKLIST
2. Intentar validar esa key → debe retornar `{"valid":false,"error":"Access revoked"}`
3. Eliminar del KV → debe volver a ser válida

---

## 11. Mantenimiento y actualizaciones

### Actualizar FRAME (contenido/diseño)

```bash
# Editar index.html localmente
git add index.html
git commit -m "feat: descripción del cambio"
git push
# → Cloudflare Pages re-despliega automáticamente
```

### Monitorear el Worker

- **Cloudflare Dashboard → Workers → frame-license-validator → Metrics**
- Ver: requests por día, tasa de errores, latencia
- Free tier: 100,000 requests/día (más que suficiente)

### Límites del plan gratuito de Cloudflare

| Recurso | Límite gratuito |
|---|---|
| Worker requests | 100,000 / día |
| KV reads | 100,000 / día |
| KV writes | 1,000 / día |
| Cloudflare Pages builds | 500 / mes |
| Pages bandwidth | Ilimitado |

Con el volumen típico de una herramienta como FRAME, el plan gratuito es más que suficiente.

---

## Resumen de URLs finales

| Recurso | URL |
|---|---|
| FRAME (app) | `https://frame.archezinternational.com` |
| Worker validador | `https://frame-license-validator.TU-SUBDOMINIO.workers.dev` |
| Gumroad producto | `https://archezinternational.gumroad.com/l/mjguide` |
| KV Blocklist | Cloudflare Dashboard → KV → FRAME_BLOCKLIST |

---

*Guía generada para Archez International · FRAME v1.0*
