-- Un negocio con suscripciones de Mercado Pago registradas no se puede borrar
-- por accidente: el cascade borraba el mapeo preapproval↔negocio y dejaba un
-- débito mensual eterno sin ningún camino de cancelación en la app (la
-- conciliación escanea mp_subscriptions y quedaba ciega). Con RESTRICT, el
-- operador tiene que cancelar el preapproval (y limpiar las filas) antes de
-- poder borrar el negocio. El borrado de negocios reales es soft (archive),
-- así que esto solo frena deletes manuales/administrativos.

alter table mp_subscriptions
	drop constraint if exists mp_subscriptions_business_id_fkey;

alter table mp_subscriptions
	add constraint mp_subscriptions_business_id_fkey
	foreign key (business_id) references businesses(id) on delete restrict;
