<script>
  let count = $state(0);
  let rows = $state([{ id: 1, n: 1 }]);
  let doubled = $derived(count * 2);
  $effect(() => { console.log(doubled); return () => {}; });
</script>
<div class="app">
  <span>{doubled}</span>
  {#each rows as row (row.id)}<li class:on={row.n > 0}>{row.n}</li>{/each}
  {#if count > 0}<p>yes</p>{:else}<p>no</p>{/if}
</div>
