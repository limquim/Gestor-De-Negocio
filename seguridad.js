// Seguridad: roles y permisos, bitácora de cambios y estado del sistema
const APP_VERSION = '18';
const ROLE_NAMES = {admin: 'Administrador', vendedor: 'Vendedor', almacen: 'Almacén', contador: 'Contador'};
const ACCESS = {   // secciones que ve cada rol (el administrador ve todo)
  vendedor: ['ventas', 'inventario', 'marketing', 'directorios'],
  almacen: ['inventario', 'produccion', 'compras', 'directorios'],
  contador: ['finanzas', 'contabilidad', 'ventas', 'compras', 'nomina', 'directorios']
};
const canSee = (m) => { if (m === 'inicio' || m === 'mas') return true; const a = ACCESS[S.role || 'admin']; return !a || a.includes(m); };

async function loadRole() {
  try {
    const u = (await db.auth.getUser()).data.user, p = await q(db.from('profiles').select('role,full_name,active').eq('id', u.id).single());
    S.userName = p.full_name || u.email;
    if (!p.active) { S.role = 'bloqueado'; toast('Tu usuario está desactivado. Habla con el administrador.', true); setTimeout(() => db.auth.signOut(), 2500); return; }
    S.role = p.role;
  } catch (e) { S.role = e.code === 'PGRST116' ? 'vendedor' : 'admin'; }   // sin perfil: acceso mínimo; si aún no existe la tabla: sin restricciones
}
function applyRoleUI() { document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('hidden', !canSee(b.dataset.tab))); }

// ---------- Panel sencillo para vendedor y almacén ----------
async function viewInicioBasico() {
  const hoy = caracasDate();
  const [v, stock, alertHtml, set] = await Promise.all([
    q(db.from('ventas_resumen').select('total_usd,exchange_rate').eq('sale_date', hoy).neq('status', 'anulada')),
    q(db.from('stock_actual').select('bajo_minimo')),
    alertasHtml(),
    q(db.from('settings').select('business_name').eq('id', 1).single())
  ]);
  const tiles = [['ventas', 'Vender', 'Nueva venta', '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'], ['compras', 'Comprar', 'Registrar compra', '<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 016 0"/>'],
    ['produccion', 'Producir', 'Fabricar productos', '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2h12.4a1.5 1.5 0 001.3-2L14 9V3"/><path d="M7.5 15h9"/>'], ['inventario', 'Inventario', 'Existencias', '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>']].filter(t => canSee(t[0]));
  const vend = v.reduce((a, r) => a + +r.total_usd, 0);
  $('#view').innerHTML = `<p class="mut" style="margin:0 0 .6rem">${esc(set.business_name || 'Mi negocio')} | ${esc(S.userName || '')} (${ROLE_NAMES[S.role] || ''})</p>
    <div class="tiles">${tiles.map((t, i) => `<button class="tile ${i === 0 ? 'main' : ''}" data-go="${t[0]}">${ico(t[3])}<span>${t[1]}</span><small>${t[2]}</small></button>`).join('')}</div>${alertHtml}
    <div class="stats">${canSee('ventas') ? `<div class="stat"><span>Vendido hoy</span><b>${fmt(vend)} USD</b><span>${v.length} ${v.length === 1 ? 'venta' : 'ventas'}</span></div>` : ''}
      ${canSee('inventario') ? `<button class="stat bad" data-go="inventario"><span>Por reponer</span><b>${stock.filter(x => x.bajo_minimo).length}</b><span>en el mínimo o agotados</span></button>` : ''}</div>`;
}

// ---------- Bitácora (solo administrador) ----------
const TBL = {sales: 'la venta', sale_returns: 'la devolución', purchases: 'la compra', expenses: 'el gasto', products: 'el producto', accounts: 'la cuenta', settings: 'la configuración', profiles: 'el usuario', payroll_runs: 'la nómina', employees: 'el empleado', employee_advances: 'el adelanto'};
const FLD = {status: 'estado', sale_price_usd: 'precio', manual_cost_usd: 'costo manual', name: 'nombre', active: 'activo', role: 'rol', total_usd: 'total', business_name: 'nombre del negocio', cost_method: 'método de costo', opening_balance: 'saldo inicial', salary_usd: 'sueldo', full_name: 'nombre'};
const av = (v) => v === null || v === undefined ? 'vacío' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'number' ? fmt(v) : String(v).slice(0, 30);
function auditText(a) {
  const base = `${TBL[a.table_name] || a.table_name} #${a.row_id}`;
  if (a.action === 'UPDATE' && a.table_name === 'sales' && a.new_data?.status === 'anulada') return `anuló la venta #${a.row_id}`;
  if (a.action === 'UPDATE') return `modificó ${base}: ` + Object.keys(a.new_data || {}).slice(0, 4).map(k => `${FLD[k] || k} de ${av(a.old_data?.[k])} a ${av(a.new_data[k])}`).join(', ');
  return `${a.action === 'INSERT' ? 'creó' : 'eliminó'} ${base}`;
}
const AUD = {u: 'all', t: 'all'};
async function viewBitacora() {
  const rows = await q(db.from('audit_log').select('*').order('id', {ascending: false}).limit(300));
  const users = [...new Set(rows.map(r => r.user_name || 'Sistema'))], tbls = [...new Set(rows.map(r => r.table_name))];
  $('#view').innerHTML = `<div class="card stack"><h2>Bitácora de cambios</h2><p class="mut">Quién creó, modificó o eliminó información importante. Se muestran los últimos 300 movimientos.</p>
    <div class="grid"><label>Usuario<select id="auU"><option value="all">Todos</option>${users.map(u => `<option ${u === AUD.u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
    <label>Sobre<select id="auT"><option value="all">Todo</option>${tbls.map(t => `<option value="${t}" ${t === AUD.t ? 'selected' : ''}>${esc(TBL[t] || t)}</option>`).join('')}</select></label></div></div><div class="list" id="auL"></div>`;
  const draw = () => {
    $('#auL').innerHTML = rows.filter(r => (AUD.u === 'all' || (r.user_name || 'Sistema') === AUD.u) && (AUD.t === 'all' || r.table_name === AUD.t))
      .map(r => `<div class="item"><span><b>${esc(r.user_name || 'Sistema')}</b> ${esc(auditText(r))}<small>${fdate(r.at)}</small></span></div>`).join('') || '<p class="mut">No hay movimientos con ese filtro.</p>';
  };
  draw();
  $('#auU').onchange = (e) => { AUD.u = e.target.value; draw(); };
  $('#auT').onchange = (e) => { AUD.t = e.target.value; draw(); };
}

// ---------- Estado del sistema ----------
const FILES = {'01': '01_esquema_base.sql', '02': '02_compras.sql (o 12_reparar_compras.sql)', '04': '04_base.sql', '05': '05_produccion.sql', '06': '06_productos.sql', '07': '07_ventas.sql', '08': '08_finanzas.sql', '09': '09_cotizaciones_marketing.sql',
  '10': '10_ticket_y_compras.sql', '11': '11_compras_cobros.sql', '13': '13_metodos_catalogo.sql', '14': '14_servicios_devoluciones.sql', '15': '15_costos_produccion_ajustes.sql', '16': '16_reinicio_nomina_deudas.sql', '17': '17_correcciones.sql', '18': '18_permisos_bitacora_estado.sql'};
async function viewEstado() {
  let rows;
  try { rows = await q(db.rpc('estado_sistema')); }
  catch (e) { $('#view').innerHTML = '<div class="card"><h2 class="warn">Falta ejecutar el paso 18</h2><p>Ejecuta el archivo 18_permisos_bitacora_estado.sql en Supabase (SQL Editor) y vuelve a abrir esta pantalla.</p></div>'; return; }
  const bad = rows.filter(r => !r.ok), pasos = [...new Set(bad.map(r => r.paso))], by = {};
  rows.forEach(r => (by[r.paso] = by[r.paso] || []).push(r));
  $('#view').innerHTML = `<div class="card"><h2 class="${bad.length ? 'warn' : 'pos'}">${bad.length ? 'Faltan pasos por instalar' : 'Todo está instalado'}</h2>
    ${bad.length ? `<p>Ejecuta en Supabase (SQL Editor), en este orden, estos archivos:</p><ul>${pasos.map(p => `<li><b>${FILES[p] || 'Paso ' + p}</b></li>`).join('')}</ul><p class="mut">Después vuelve a abrir esta pantalla para comprobarlo.</p>` : '<p class="mut">La base de datos tiene todo lo que la aplicación necesita.</p>'}
    <p class="mut">Versión de la aplicación: ${APP_VERSION} | Tu rol: ${ROLE_NAMES[S.role] || S.role} | Usuario: ${esc(S.userName || '')}</p></div>
    ${Object.entries(by).map(([p, items]) => `<div class="card"><h2>Paso ${p}</h2>${items.map(i => `<div class="rl"><span>${esc(i.item)}</span><b class="${i.ok ? 'pos' : 'neg'}">${i.ok ? 'OK' : 'FALTA'}</b></div>`).join('')}</div>`).join('')}`;
}
