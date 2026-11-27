// Seguridad y bitácora local (Edición Emprendedores)
const APP_VERSION = 'E3.0';
const ROLE_NAMES = {admin: 'Dueño / Administrador'};

const canSee = (m) => {
  if (m === 'inicio' || m === 'mas' || m === 'ventas' || m === 'finanzas' || m === 'contabilidad' || m === 'directorios' || m === 'configuracion' || m === 'apertura') return true;
  if (m === 'inventario') return true; // si inventory=false, abre solo Servicios/Productos
  if (m === 'compras') return hasMod('purchases');
  if (m === 'produccion') return hasMod('production');
  if (m === 'marketing') return hasMod('marketing');
  if (m === 'nomina') return hasMod('payroll');
  return true;
};

async function loadRole() {
  S.role = 'admin';
  try {
    const s = await q(db.from('settings').select('owner_name').eq('id', 1).single());
    S.userName = s?.owner_name || 'Dueño';
  } catch (e) {
    S.userName = 'Dueño';
  }
}
function applyRoleUI() { if (typeof applyModsUI === 'function') applyModsUI(); }

// ---------- Bitácora local ----------
const TBL = {sales: 'la venta', sale_returns: 'la devolución', purchases: 'la compra', expenses: 'el gasto', products: 'el producto', accounts: 'la cuenta', settings: 'la configuración', payroll_runs: 'la nómina', employees: 'el empleado', employee_advances: 'el adelanto', cash_closings: 'el cierre de caja', payment_methods: 'el método de pago', inventory_adjustments: 'el ajuste masivo', recurring_expenses: 'el gasto fijo', parties: 'el contacto'};
const FLD = {status: 'estado', sale_price_usd: 'precio', manual_cost_usd: 'costo manual', name: 'nombre', active: 'activo', total_usd: 'total', business_name: 'nombre del negocio', cost_method: 'método de costo', opening_balance: 'saldo inicial', payment_details: 'datos de pago', is_default: 'cuenta principal', monthly_sales_goal_usd: 'meta mensual', max_discount_percent: 'tope de descuento', block_negative_stock: 'bloquear sin stock', salary_usd: 'sueldo'};
const av = (v) => v === null || v === undefined ? 'vacío' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'number' ? fmt(v) : String(v).slice(0, 30);

function auditText(a) {
  const base = `${TBL[a.table_name] || a.table_name} #${a.row_id}`;
  if (a.action === 'UPDATE' && a.table_name === 'sales' && a.new_data?.status === 'anulada') return `anuló la venta #${a.row_id}`;
  if (a.action === 'UPDATE' && a.table_name === 'purchases' && a.new_data?.status === 'anulada') return `anuló la compra #${a.row_id}`;
  if (a.action === 'UPDATE') return `modificó ${base}: ` + Object.keys(a.new_data || {}).slice(0, 4).map(k => `${FLD[k] || k} de ${av(a.old_data?.[k])} a ${av(a.new_data[k])}`).join(', ');
  return `${a.action === 'INSERT' ? 'creó' : 'eliminó'} ${base}`;
}
const AUD = {t: 'all'};
async function viewBitacora() {
  const rows = await q(db.from('audit_log').select('*').order('id', {ascending: false}).limit(200));
  const tbls = [...new Set(rows.map(r => r.table_name))];
  $('#view').innerHTML = `<div class="card stack"><h2>Bitácora de cambios</h2><p class="mut">Registro local de los últimos movimientos importantes en tu negocio.</p>
    <label>Filtrar por sección<select id="auT"><option value="all">Todo</option>${tbls.map(t => `<option value="${t}" ${t === AUD.t ? 'selected' : ''}>${esc(TBL[t] || t)}</option>`).join('')}</select></label></div><div class="list" id="auL"></div>`;
  const draw = () => {
    $('#auL').innerHTML = rows.filter(r => AUD.t === 'all' || r.table_name === AUD.t)
      .map(r => `<div class="item"><span><b>${esc(r.user_name || 'Dueño')}</b> ${esc(auditText(r))}<small>${fdate(r.at)}</small></span></div>`).join('') || '<p class="mut">Aún no hay movimientos registrados.</p>';
  };
  draw();
  $('#auT').onchange = (e) => { AUD.t = e.target.value; draw(); };
}
