<script lang="ts">
  let { pct, color, text, label, size = 17 }: { pct: number; color: string; text: string; label: string; size?: number } = $props();
  const C = 194.8;
</script>

<div>
  <svg viewBox="0 0 76 76">
    <circle cx="38" cy="38" r="31" fill="none" stroke="var(--s3)" stroke-width="7" />
    <circle cx="38" cy="38" r="31" fill="none" stroke={color} stroke-width="7" stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={C * (1 - Math.min(1, pct / 100))} transform="rotate(-90 38 38)" />
    <text x="38" y="44" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size={size} fill="var(--ink)">{text}</text>
  </svg>
  <small>{label}</small>
</div>
