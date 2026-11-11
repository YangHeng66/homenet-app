<script lang="ts">
  import { I, type IconName } from '../../lib/icons';
  let { name }: { name: IconName } = $props();
</script>

{@html I[name]}
