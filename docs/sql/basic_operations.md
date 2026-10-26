---
title: SQL Basic Operations
description: Core Yolm SQL operations for querying and mutating data with SELECT, INSERT, UPDATE, DELETE, MERGE, grouping, ordering, and set operations.
tags:
  - sql
  - queries
  - mutations
---

# SQL Basic Operations

## SELECT, FROM, WHERE

The SELECT statement retrieves data from one or more tables. FROM specifies the table(s), WHERE filters results.

```sql
select title, price
from book
where publication_year > 1900;
```

## INSERT

Use `insert` with an explicit target table and either `values` or a query.

### Specify columns and values

```sql
insert into book (title, author, publication_year, price, is_bestseller)
values ('To Kill a Mockingbird', 3, 1960, 11.99, true);
```

Multiple rows:

```sql
insert into book (title, author, publication_year, price, is_bestseller)
values
    ('Book 1', 1, 1960, 11.99, true),
    ('Book 2', 2, 1970, 12.99, false);
```

### Insert from a query

```sql
insert into book select * from temporary_book;

insert into book (title, author, publication_year)
select title, author_id, year
from imported_books;
```

### ON CONFLICT

`insert ... on conflict` is accepted for upserts.

```sql
insert into product (sku, name, price)
values ('A-001', 'Widget', 12.50)
on conflict (sku) do update
set name = excluded.name,
    price = excluded.price;

insert into product (sku, name)
values ('A-001', 'Widget')
on conflict (sku) do nothing;
```

## UPDATE

Modifies existing records based on conditions.

```sql
update book
set price = price * 1.1
where publication_year < 1950;
```

## DELETE

Removes records based on conditions.

```sql
delete from sale
where sale_date < '2023-01-01';
```

`delete` also accepts a `using` source when the delete condition needs another
relation:

```sql
delete from sale
using customer
where sale.customer_id = customer.id
  and customer.is_test_account;
```

## MERGE

Combines INSERT, UPDATE, and DELETE operations. Useful for synchronizing data or handling upserts.

```sql
merge into book
using new_book on (book.id = new_book.id)
when matched then
    update set
        price = new_book.price,
        is_bestseller = new_book.is_bestseller
when not matched then
    insert (id, title, price, is_bestseller)
    values (new_book.id, new_book.title, new_book.price, new_book.is_bestseller)
when not matched by source and book.publication_year < 1900 then
    delete;
```

`merge` supports:

- `when matched then update set ...`
- `when matched then delete`
- `when not matched then insert (...) values (...)`
- `when not matched by source then update set ...`
- `when not matched by source then delete`
- Optional `and <condition>` on each `when` clause

### Real-World MERGE Patterns

#### Domain Synchronization

Synchronize domain mappings, removing domains not in the source:

```sql
merge into system_domains using domains
  on system_domains.domain = domains.domain and system_domains.system_id = deploy_system_id
  when not matched then
    insert (system_id, domain)
    values (deploy_system_id, domains.domain)
  when not matched by source and system_domains.system_id = deploy_system_id then
    delete
```

This pattern:
1. Inserts new domains that don't exist
2. Keeps matching domains unchanged
3. Deletes domains not in the source (but only for this specific system_id)

#### Upsert with Derived Tables

Use a derived table as the source. Here `record` is a procedure record
holding one incoming row:

```sql
merge into db.products
using (
  select
    record.sku as sku,
    record.name as name,
    record.price::decimal(10,2) as price
) as src
on db.products.sku = src.sku
when matched then
  update set
    name = src.name,
    price = src.price
when not matched then
  insert (sku, name, price)
  values (src.sku, src.name, src.price)
```

Do not add `created_at` / `updated_at` fields just to track changes; read
change times from [transaction queries](./transaction_queries.md) instead.

#### Conditional MERGE

Delete only specific records when not matched by source:

```sql
merge into inventory
using new_stock on inventory.product_id = new_stock.product_id
when matched then
  update set quantity = new_stock.quantity
when not matched then
  insert (product_id, quantity) values (new_stock.product_id, new_stock.quantity)
when not matched by source and inventory.warehouse_id = current_warehouse_id then
  delete  -- Only delete from current warehouse
```

## GROUP BY, HAVING

GROUP BY groups rows with same values. HAVING filters groups based on aggregate conditions.

```sql
select author, avg(price) as avg_price
from book
group by author
having avg(price) > 10;
```

Yolm also accepts `rollup`, `cube`, and `grouping sets`:

```sql
select region, product_category, sum(amount)
from sales
group by rollup(region, product_category);

select region, product_category, sum(amount)
from sales
group by grouping sets ((region), (product_category), ());
```

`group by all` is not supported.

## ORDER BY, LIMIT, OFFSET

ORDER BY sorts results, LIMIT restricts row count, OFFSET skips rows.

```sql
select title, publication_year
from book
order by publication_year desc
limit 3
offset 1;
```

SQL Server-style `top` is accepted in queries:

```sql
select top 10 title from book order by publication_year desc;
```

`fetch first` / `fetch next`, `order by all`, `top with ties`, and
`top percent` are not supported.

## DISTINCT

Returns only unique values.

```sql
select distinct nationality
from author;

select distinct on (author_id) author_id, title
from book
order by author_id, publication_year desc;
```

## UNION, INTERSECT, EXCEPT

Set operations combining multiple SELECT statements.

```sql
(select title from book where author = 0)
union
(select title from book where author = 1);
```

`union all`, `intersect all`, and `except all` are also accepted.

## RETURNING INTO

`insert`, `update`, `delete`, `merge`, and `insert ... on conflict` can write
one output row for every directly affected row into a procedure destination:

```sql
returning expression [as output_name] [, ...]
into procedure_target [(target_field [, ...])]
```

Use a procedure table when a statement can affect multiple rows. Table output
appends to rows already in the destination. A scalar accepts one expression
and a record accepts one row; execution raises a cardinality error if an
unproven statement produces a second row. If no rows are affected, a scalar or
record remains absent.

```typescript
s.defTable("created_books", {
  fields: [
    { name: "book_id", type: "BigInt" },
    { name: "title", type: "String" },
  ],
});

s.modify(sql`
  insert into db.book (title, author)
  select title, author_id from new_books
  returning id as book_id, title into created_books
`);
```

Without an explicit target-field list, output names must match destination
fields. Direct fields keep their names; other expressions require `as`. An
explicit field list assigns expressions positionally:

```sql
update db.book
set price = price * 1.1
where author = target_author
returning id, old.price, new.price
into changed_books (book_id, previous_price, current_price);
```

The unqualified target-table field is the new value for `insert` and `update`,
the old value for `delete`, and the action-appropriate value for `merge`.
Explicit `old.field` and `new.field` references are also available; a missing
row image is null. `*`, `old.*`, and `new.*` omit hidden fields. Aggregates,
window expressions, mutations, and self-referential subqueries are not allowed
in the output list.

For `merge`, output expressions may also reference source fields.
`merge_action()` returns `INSERT`, `UPDATE`, or `DELETE` for each affected row:

```sql
merge into db.book
using imported_books source on db.book.external_id = source.external_id
when matched then update set title = source.title
when not matched then
  insert (external_id, title) values (source.external_id, source.title)
returning merge_action() as action, id, source.external_id
into imported_results;
```

`on conflict do nothing` emits no row for a skipped candidate. A row changed by
`on conflict do update` exposes both its old and new target images.

Returned values include defaults and generated fields and observe the direct
mutation before AFTER triggers or reactors run. Output order is unspecified;
return a correlation key instead of relying on row position. Generated IDs
returned from a multirow insert can feed later set-based child inserts in the
same transaction when their lineage remains direct and type-safe.

A transaction rollback or optimistic-concurrency retry discards the attempt's
output. A caught `insert` error restores that statement's destination output.
Caught `update` and `delete` errors preserve output from earlier successful
rows, while the failing row emits nothing. Errors from streaming `merge`
execution currently escape a procedure `try` block.

## Mutation Limitations

Yolm does not accept `order by` or `limit` directly after `insert`, `update`, or
`delete`. Select the target records in a subquery or CTE first, then mutate by
key.
