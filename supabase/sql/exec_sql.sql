create or replace function public.exec_sql(sql text) returns jsonb language plpgsql security definer as $$
declare
  stmt text;
begin
  execute 'set search_path = public';
  for stmt in select * from regexp_split_to_table(sql, ';') loop
    stmt := trim(stmt);
    if stmt <> '' then
      execute stmt;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
exception when others then
  raise;
end;
$$;
