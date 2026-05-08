export const reportStyles = `
      /* ── Layout ── */
      .report-container { font-family: 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto; }
      .report-section { margin-bottom: 32px; }
      .report-section-break { margin-bottom: 32px; page-break-before: always; }
      .grid-2col { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px; }
      .grid-3col-12 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .grid-3col-16 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      .grid-3col-time { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center; }
      .grid-score-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 24px; }
      .flex-between { display: flex; justify-content: space-between; }
      .flex-end { display: flex; justify-content: flex-end; margin-top: 16px; }
      .flex-between-center { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
      .flex-center-gap { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .flex-wrap-gap { display: flex; flex-wrap: wrap; gap: 6px; }

      /* ── Header ── */
      .report-header { background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
      .report-title { font-size: 24px; font-weight: bold; margin-bottom: 8px; }
      .report-header-subtitle { opacity: 0.9; margin-bottom: 4px; }
      .report-header-meta { font-size: 14px; opacity: 0.8; margin-bottom: 12px; }
      .report-score-box { background: white; padding: 16px 24px; border-radius: 8px; text-align: center; }
      .report-grade { font-size: 28px; font-weight: bold; color: #16a34a; }
      .report-score-value { font-size: 14px; color: #4b5563; }
      .report-score-label { font-size: 11px; color: #6b7280; }

      /* ── Section headings ── */
      .section-heading { font-size: 20px; font-weight: bold; color: #1f2937; padding-bottom: 8px; margin-bottom: 16px; border-bottom-width: 2px; border-bottom-style: solid; }
      .section-heading-indigo { border-bottom-color: #4f46e5; }
      .section-heading-amber { border-bottom-color: #f59e0b; margin-bottom: 20px; }
      .section-heading-violet { border-bottom-color: #8b5cf6; }
      .section-heading-pink { border-bottom-color: #ec4899; }

      /* ── Time analysis ── */
      .time-analysis-card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
      .time-analysis-heading { font-size: 15px; font-weight: 600; color: #0369a1; margin-bottom: 10px; }
      .time-value-blue { font-size: 20px; font-weight: bold; color: #0284c7; }
      .time-label-blue { font-size: 13px; color: #0369a1; }
      .time-value-green { font-size: 20px; font-weight: bold; color: #16a34a; }
      .time-label-green { font-size: 13px; color: #15803d; }
      .time-feedback { font-size: 11px; color: #9a3412; }

      /* ── Score cards ── */
      .score-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
      .score-card-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
      .score-name { font-size: 13px; font-weight: 600; color: #374151; }
      .score-badge { background: #dbeafe; color: #1e40af; padding: 2px 7px; border-radius: 4px; font-size: 12px; font-weight: 600; }
      .score-feedback { font-size: 12px; color: #4b5563; line-height: 1.5; margin: 6px 0 0 0; }

      /* ── Overall evaluation ── */
      .eval-container { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; }
      .eval-heading { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
      .eval-card-green { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; }
      .eval-card-orange { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px; }
      .eval-card-blue { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; }
      .eval-card-title-green { font-size: 13px; font-weight: 700; color: #166534; margin-bottom: 8px; }
      .eval-card-title-orange { font-size: 13px; font-weight: 700; color: #9a3412; margin-bottom: 8px; }
      .eval-card-title-blue { font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 8px; }
      .eval-item-green { font-size: 12px; color: #166534; margin-bottom: 4px; }
      .eval-item-orange { font-size: 12px; color: #7c2d12; margin-bottom: 4px; }
      .eval-item-blue { font-size: 12px; color: #1e3a8a; margin-bottom: 4px; }
      .ranking-block { margin-top: 12px; padding: 12px; background: #f0f4ff; border-left: 4px solid #4f46e5; border-radius: 0 6px 6px 0; }
      .ranking-text { font-size: 13px; color: #312e81; line-height: 1.6; margin: 0; }

      /* ── Practice guide shared ── */
      .subsection-heading { font-size: 15px; font-weight: 700; color: #1f2937; margin-bottom: 14px; }
      .guide-card-inner-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px; }

      /* ── Behavior guides ── */
      .guide-card-yellow { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid; }
      .guide-num-badge-yellow { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #f59e0b; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0; }
      .guide-title-yellow { font-size: 14px; font-weight: 600; color: #92400e; margin: 0; }
      .guide-action-block { background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px; border-radius: 6px; }
      .guide-action-label { font-size: 11px; font-weight: 700; color: #4f46e5; margin: 0 0 4px 0; }
      .guide-action-text { font-size: 12px; color: #374151; margin: 0; line-height: 1.5; }
      .guide-example-block { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px; border-radius: 6px; }
      .guide-example-label { font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0; }
      .guide-example-text { font-size: 12px; color: #166534; margin: 0; line-height: 1.5; font-style: italic; }
      .guide-impact { border-top: 1px solid #fde68a; padding-top: 8px; font-size: 12px; color: #374151; }

      /* ── Conversation guides ── */
      .guide-card-teal { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid; }
      .guide-num-badge-teal { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #06b6d4; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0; }
      .guide-title-teal { font-size: 14px; font-weight: 600; color: #0f766e; margin: 0; }
      .guide-good-block { background: #dcfce7; border: 1px solid #86efac; padding: 10px; border-radius: 6px; }
      .guide-good-label { font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0; }
      .guide-good-text { font-size: 12px; color: #166534; margin: 0; line-height: 1.5; }
      .guide-bad-block { background: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 6px; }
      .guide-bad-label { font-size: 11px; font-weight: 700; color: #dc2626; margin: 0 0 4px 0; }
      .guide-bad-text { font-size: 12px; color: #991b1b; margin: 0; line-height: 1.5; }
      .guide-key-points { border-top: 1px solid #99f6e4; padding-top: 8px; }
      .guide-key-points-label { font-size: 11px; font-weight: 700; color: #6b7280; margin: 0 0 6px 0; }
      .guide-key-point-badge { font-size: 11px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 3px 10px; border-radius: 20px; }

      /* ── Development plan ── */
      .plan-card-short { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; }
      .plan-card-short .plan-card-title { color: #16a34a; }
      .plan-card-short .plan-card-goal { color: #16a34a; }
      .plan-card-short .plan-card-meas { background: #dcfce7; color: #166534; }
      .plan-card-medium { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 0 8px 8px 0; }
      .plan-card-medium .plan-card-title { color: #2563eb; }
      .plan-card-medium .plan-card-goal { color: #2563eb; }
      .plan-card-medium .plan-card-meas { background: #dbeafe; color: #1e40af; }
      .plan-card-long { background: #faf5ff; border-left: 4px solid #a855f7; padding: 16px; border-radius: 0 8px 8px 0; }
      .plan-card-long .plan-card-title { color: #7c3aed; }
      .plan-card-long .plan-card-goal { color: #7c3aed; }
      .plan-card-long .plan-card-meas { background: #f3e8ff; color: #6b21a8; }
      .plan-card-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
      .plan-item-card { background: white; padding: 12px; border-radius: 4px; margin-bottom: 8px; }
      .plan-card-goal { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
      .plan-actions-list { list-style: none; padding: 0; margin: 0 0 8px 0; }
      .plan-action-item { font-size: 12px; color: #4b5563; }
      .plan-card-meas { font-size: 11px; padding: 4px 8px; border-radius: 4px; }
      .resource-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
      .resource-heading { font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 12px; }
      .resource-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .resource-item { background: white; padding: 8px 12px; border-radius: 4px; font-size: 13px; color: #4b5563; }

      /* ── Strategy evaluation ── */
      .strategy-panel { background: #fdf4ff; border-left: 4px solid #a855f7; padding: 20px; border-radius: 0 8px 8px 0; }
      .strategy-score-label { font-size: 16px; font-weight: 600; color: #7c3aed; }
      .strategy-score-badge { background: #e9d5ff; color: #7c3aed; padding: 8px 16px; border-radius: 8px; font-size: 18px; font-weight: bold; }
      .strategy-rationale { font-size: 14px; color: #6b21a8; margin-bottom: 16px; }
      .strategy-subsection { margin-bottom: 16px; }
      .strategy-title-blue { font-size: 14px; font-weight: 600; color: #2563eb; margin-bottom: 8px; }
      .strategy-text-box { font-size: 13px; color: #374151; background: white; padding: 12px; border-radius: 4px; }
      .strategy-title-yellow { font-size: 14px; font-weight: 600; color: #eab308; margin-bottom: 8px; }
      .strategy-insights-box { font-size: 13px; color: #374151; background: #fef9c3; padding: 12px; border-radius: 4px; border-left: 4px solid #eab308; }
      .strategy-title-green { font-size: 14px; font-weight: 600; color: #16a34a; margin-bottom: 8px; }
      .strategy-alt-item { display: flex; align-items: flex-start; gap: 8px; background: #dcfce7; padding: 12px; border-radius: 4px; margin-bottom: 8px; }
      .strategy-alt-badge { background: #22c55e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
      .strategy-alt-text { font-size: 13px; color: #166534; margin: 0; }

      /* ── Score status badges ── */
      .score-status-high { color: #166534; background: #dcfce7; border-radius: 20px; padding: 1px 8px; font-size: 10px; font-weight: 600; }
      .score-status-mid  { color: #9a3412; background: #ffedd5; border-radius: 20px; padding: 1px 8px; font-size: 10px; font-weight: 600; }
      .score-status-low  { color: #991b1b; background: #fee2e2; border-radius: 20px; padding: 1px 8px; font-size: 10px; font-weight: 600; }

      /* ── Time rating badges ── */
      .time-rating-excellent { font-size: 16px; font-weight: 600; color: #16a34a; }
      .time-rating-good      { font-size: 16px; font-weight: 600; color: #2563eb; }
      .time-rating-average   { font-size: 16px; font-weight: 600; color: #d97706; }
      .time-rating-poor      { font-size: 16px; font-weight: 600; color: #dc2626; }

      /* ── Footer ── */
      .report-footer { text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #9ca3af; font-size: 12px; }

      /* ── Utility spacing ── */
      .mb-24 { margin-bottom: 24px; }
      .mb-20 { margin-bottom: 20px; }
      .page-no-break { page-break-inside: avoid; }

      /* ── Print toolbar (screen-only) ── */
      .print-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #e2e8f0; }
      .print-toolbar-title { font-size: 18px; color: #1e3a5f; margin: 0; }
      .print-btn-primary { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; margin-right: 8px; }
      .print-btn-secondary { background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }

      /* ── Rubric section ── */
      .rubric-section { background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 14px 16px; margin-top: 28px; }
      .rubric-section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .rubric-section-title { font-size: 13px; font-weight: 700; color: #4c1d95; margin: 0; }
      .rubric-version-badge { background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; border-radius: 4px; font-size: 10px; font-weight: 600; padding: 1px 6px; }
      .rubric-status-badge { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 10px; padding: 1px 6px; }
      .rubric-dims-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .rubric-dim-item { background: white; border: 1px solid #ddd6fe; border-radius: 6px; padding: 7px 10px; }
      .rubric-dim-name { font-size: 11px; font-weight: 600; color: #374151; margin-bottom: 2px; }
      .rubric-dim-weight { font-size: 10px; color: #6d28d9; font-weight: 700; }
      .rubric-dim-range { font-size: 10px; color: #9ca3af; }
      .rubric-no-dims { font-size: 12px; color: #9ca3af; font-style: italic; }

      /* ── Print-specific overrides ── */
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
      }
`;
