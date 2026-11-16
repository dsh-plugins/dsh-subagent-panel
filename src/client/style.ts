export const styles = `
.dsp-panel{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;container-type:inline-size;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.dsp-panel *{box-sizing:border-box}
.dsp-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);padding:4px 8px;cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;transition:background-color 100ms ease,color 100ms ease}
.dsp-button:disabled{opacity:.4;cursor:default}
.dsp-button>.i-icon,.dsp-item>summary>.i-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0}
.dsp-button>.i-icon>svg,.dsp-item>summary>.i-icon>svg{display:block}
.dsp-button:focus-visible,.dsp-task:focus-visible,.dsp-item>summary:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsp-icon-button{flex:none;width:28px;height:28px;padding:0}
.dsp-menu-trigger{border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary)}
.dsp-launcher{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsp-count{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dsp-toolbar{display:flex;align-items:center;gap:12px;padding:12px 16px;flex:none}
.dsp-heading{min-width:0;flex:1;display:flex;align-items:center;gap:12px;font-weight:500}
.dsp-meta{font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.dsp-transcript{position:relative;display:flex;flex:1;min-height:0;min-width:0}
.dsp-scroll{flex:1;min-height:0;min-width:0}
.dsp-content{padding:16px 20px 24px 32px;overflow-wrap:anywhere}
.dsp-content img{max-width:100%}
.dsp-item{min-width:0;margin:4px 0}
.dsp-item-user{margin:24px 0 16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-turn-trigger-bg,var(--dsw-alias-markdown-code-block))}
.dsp-item-user:first-child{margin-top:0}
.dsp-item>summary{display:flex;align-items:center;gap:6px;list-style:none;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px)}
.dsp-item>summary::-webkit-details-marker{display:none}
.dsp-item-user>summary{gap:10px;padding:12px 16px;line-height:20px}
.dsp-trigger-title{flex:1;min-width:0;font-size:var(--dsh-content-font-size,14px)}
.dsp-item-user time{font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dsp-chevron{transition:transform 100ms ease}
.dsp-item[open]>summary>.dsp-chevron{transform:rotate(180deg)}
.dsp-user-scroll{max-height:240px;margin:0 4px 12px 40px}
.dsp-user-text{white-space:pre-wrap;overflow-wrap:anywhere;padding-right:0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}
.dsp-item-assistant{margin:12px 0;line-height:calc(26px + var(--dsh-content-font-delta,0px))}
.dsp-item-notice{font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary);padding:4px 0 4px 22px;white-space:pre-wrap}
.dsp-detail>summary{min-height:calc(24px + var(--dsh-content-font-delta,0px));padding:0;border-radius:var(--dsw-radius-sm)}
.dsp-detail-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-detail-body{padding:4px 0 4px 22px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}
.dsp-code{margin:0 0 8px;padding:12px 14px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--ds-font-family-code);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.65}
.dsp-code:last-child{margin-bottom:0}
.dsp-dot{display:inline-block;flex:none;width:6px;height:6px;background:var(--dsw-alias-label-caption);border-radius:50%}
.dsp-dot.running,.dsp-dot.starting{background:var(--dsw-alias-state-business-primary);animation:dsp-pulse 1.2s ease-in-out infinite}
.dsp-dot.completed,.dsp-dot.idle{background:var(--dsw-alias-state-success-primary)}
.dsp-dot.error{background:var(--dsw-alias-state-error-primary)}
.dsp-failed,.dsp-turn.error{color:var(--dsw-alias-state-error-primary)}
.dsp-turn{display:flex;align-items:center;gap:6px;margin:16px 0 12px;padding-bottom:8px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size,14px);font-variant-numeric:tabular-nums}
.dsp-turn-meta{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin:16px 0 24px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
.dsp-turn-meta>span{display:inline-flex;align-items:center;gap:6px}
.dsp-composer-seat{flex:none;min-width:0;padding:0 16px 4px}
.dsp-composer{display:flex;flex-direction:column;gap:12px;min-width:0;padding-top:8px;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-specific-input-major);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-soft)}
.dsp-editor-scroll{max-height:170px;margin-right:4px}
.dsp-input-grow{display:grid;min-width:0}
.dsp-input,.dsp-input-grow::after{box-sizing:border-box;grid-area:1/1;min-width:0;width:100%;min-height:36px;padding:4px 0 0 14px;border:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.dsp-input-grow::after{content:attr(data-draft) ' ';visibility:hidden;pointer-events:none}
.dsp-input{display:block;resize:none;border-radius:0;overflow:hidden;background:transparent;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);outline:none}
.dsp-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsp-composer:focus-within{outline:1px solid var(--dsw-alias-border-l3)}
.dsp-compose-actions{display:flex;align-items:center;gap:8px;min-width:0;padding:2px 8px 6px}
.dsp-provider{display:inline-flex;align-items:center;gap:6px;min-width:0;flex:none;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap}
.dsp-model{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}
.dsp-send{flex:none;width:34px;height:34px;padding:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-on-color);transform:translateY(-2px)}
.dsp-stop{flex:none;width:28px;height:28px;padding:0;border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary)}
.dsp-stop>span{width:10px;height:10px;border-radius:2px;background:currentColor}
.dsp-composer-hint{min-height:26px;padding:4px 0 0;text-align:center;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsp-error{margin:8px 16px;padding:8px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px);white-space:pre-wrap;overflow-wrap:anywhere}
.dsp-error button{margin-left:10px}
.dsp-empty{text-align:center;padding:55px 24px;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px)}
.dsp-empty strong{display:block;color:var(--dsw-alias-label-secondary);margin-bottom:10px;font-weight:500}
.dsp-task-list{padding:4px 0 16px 12px}
.dsp-task{display:flex;align-items:center;gap:10px;width:100%;min-width:0;text-align:left;margin:2px 0;padding:12px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsp-task-copy{display:flex;flex-direction:column;flex:1;min-width:0;gap:2px}
.dsp-task-title{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dsp-task time{flex:none;font-size:12px}
.dsp-footer{display:flex;flex-direction:column;gap:2px;padding:8px}
.dsp-footer .dsp-button{justify-content:flex-start;min-height:32px}
.dsp-footer .dsp-task-title{flex:1;text-align:left}
.dsp-footer .dsp-meta{white-space:nowrap}
.dsp-follow{position:absolute;left:50%;bottom:16px;z-index:1;width:34px;height:34px;padding:0;border-radius:999px;corner-shape:round;color:var(--dsw-alias-label-primary);transform:translateX(-50%)}
.dsp-spinning{animation:dsp-spin 800ms linear infinite}
@media(hover:hover){.dsp-button:hover:not(:disabled),.dsp-task:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsp-item-user:hover{background:var(--dsw-alias-turn-trigger-bg-hover,var(--dsw-alias-interactive-bg-hover))}.dsp-item>summary:hover{color:var(--dsw-alias-label-secondary)}.dsp-menu-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.dsp-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}.dsp-follow:hover:not(:disabled){background:transparent}}
@container(max-width:420px){.dsp-content{padding-left:24px;padding-right:12px}.dsp-composer-seat{padding-left:8px;padding-right:8px}.dsp-heading .dsp-meta,.dsp-task time{display:none}.dsp-item-user>summary{gap:6px;padding:12px}.dsp-item-user time{font-size:11px}.dsp-compose-actions{gap:6px}.dsp-provider{max-width:88px;overflow:hidden;text-overflow:ellipsis}}
@media(pointer:coarse){.dsp-input,.dsp-input-grow::after{font-size:max(16px,var(--dsh-content-font-size,14px))}}
@keyframes dsp-pulse{50%{opacity:.35}}@keyframes dsp-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dsp-dot.running,.dsp-dot.starting,.dsp-spinning{animation:none}.dsp-button,.dsp-chevron{transition:none}}
`;
