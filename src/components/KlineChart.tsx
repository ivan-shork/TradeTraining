/** klinecharts v9.8 封装：K线主图 + 成交量 + MA + 画线 + 买卖点标记 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  init, dispose, LineType, OverlayMode, PolygonType, TooltipShowRule, TooltipShowType,
  type Chart, type OverlayEvent, type CandleTooltipCustomCallbackData,
} from 'klinecharts'
import type { Kline, Trade } from '@shared/types'
import { aggregateWeekly, toCandle, dateToTs, fmtDisp } from '@shared/kline'

/** 画线工具名（klinecharts 内置 overlay） */
export const DRAW_TOOLS: { key: string; label: string }[] = [
  { key: 'segment', label: '趋势线' },
  { key: 'horizontalStraightLine', label: '水平线' },
  { key: 'priceChannelLine', label: '平行通道' },
  { key: 'rect', label: '矩形框' },
  { key: 'fibonacciLine', label: '斐波那契' },
  { key: 'measure', label: '测距' },
  { key: 'text', label: '文字' },
]

export interface SavedOverlay {
  toolType: string
  pointsJson: string
  styleJson: string
  visible: boolean
  /** 图表内 overlay id（用于删除单条时定位） */
  overlayId?: string
}

/** 暴露给父组件的操作句柄 */
export interface KlineChartHandle {
  removeOverlayById: (id: string) => void
}

interface Props {
  klines: Kline[]              // 上下文 + 已揭示（日 K）
  freq: 'D' | 'W'
  contextBars: number          // 上下文根数（画分隔虚线）
  trades: Trade[]              // 已成交（标记箭头）
  activeTool: string | null    // 当前激活的画线工具
  onOverlayComplete?: (o: SavedOverlay) => void
  onToolConsumed?: () => void  // 一条画线完成后清空激活状态
  overlays?: SavedOverlay[]    // 复盘回放时还原
  upColor?: 'red' | 'green'
  blindMode?: boolean          // 盲训：隐藏一切日期信息（x轴刻度/十字光标/tooltip）
  maPeriods?: number[]         // 启用的 MA 周期（如 [5,20,60,120]）
  onOverlaySelected?: (id: string | null) => void  // 画线选中/取消选中
}

const MA_COLORS = ['#ffb84d', '#4f7cff', '#c47aff', '#38b478']
const MA_LINE = (color: string) => ({
  style: LineType.Solid, size: 1, color, dashedValue: [2, 2], smooth: false,
})

const KlineChart = forwardRef<KlineChartHandle, Props>(function KlineChart(props, ref) {
  const boxRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const markerIdsRef = useRef<(string | null)[]>([])
  const propsRef = useRef(props)
  propsRef.current = props

  useImperativeHandle(ref, () => ({
    removeOverlayById: (id: string) => {
      chartRef.current?.removeOverlay(id)
    },
  }), [])

  // ---- 初始化（一次） ----
  useEffect(() => {
    if (!boxRef.current) return
    const chart = init(boxRef.current, {
      styles: {
        grid: { horizontal: { color: '#1e2636' }, vertical: { color: '#1e2636' } },
        candle: {
          bar: {
            upColor: '#ef5350', downColor: '#26a69a',
            upBorderColor: '#ef5350', downBorderColor: '#26a69a',
            upWickColor: '#ef5350', downWickColor: '#26a69a',
          },
          priceMark: { high: { color: '#8b93a7' }, low: { color: '#8b93a7' } },
        },
        indicator: { bars: [{ upColor: '#ef5350', downColor: '#26a69a' }] },
        crosshair: {
          horizontal: { text: { backgroundColor: '#2a3245' } },
          vertical: { text: { backgroundColor: '#2a3245' } },
        },
        xAxis: { axisLine: { color: '#2a3245' }, tickText: { color: '#8b93a7' }, tickLine: { color: '#2a3245' } },
        yAxis: { axisLine: { color: '#2a3245' }, tickText: { color: '#8b93a7' }, tickLine: { color: '#2a3245' } },
      },
    })
    if (!chart) return
    chartRef.current = chart
    chart.setOffsetRightDistance(120)   // 右侧未来空白区（需求 5.5.1）
    chart.setBarSpace(8)

    // 主图 MA + 副图 VOL
    chart.createIndicator({ name: 'MA', calcParams: props.maPeriods ?? [5, 20, 60, 120] }, false, { id: 'candle_pane' })
    chart.createIndicator('VOL', false, { id: 'vol_pane' })

    return () => {
      if (boxRef.current) dispose(boxRef.current)
      chartRef.current = null
    }
  }, [])

  // ---- 数据更新 ----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const src = props.klines
    const view = props.freq === 'W' ? aggregateWeekly(src) : src
    const data = view.map(toCandle)
    // 最后一根进行中周 K
    if (props.freq === 'W' && data.length) data[data.length - 1].partial = true
    chart.applyNewData(data)
    // 上下文/交易区分隔线已按用户要求移除（原实现每步叠加导致"顶满图表"）；
    // 起点位置由顶栏"第 N 步"与最新 K 线位置表达
  }, [props.klines, props.freq, props.contextBars])

  // ---- 买卖点标记（simpleAnnotation，悬停显示明细） ----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    for (const id of markerIdsRef.current) {
      if (id) { try { chart.removeOverlay(id) } catch { /* 已销毁 */ } }
    }
    markerIdsRef.current = props.trades.map((t) => {
      const text = `${t.side === 'buy' ? '买' : '卖'} ${t.qty} 份 @${t.price}${t.note ? `\n${t.note}` : ''}`
      // 买=红底白字 / 卖=绿底白字（需求：色块标注，替代晃眼的彩点彩字）
      const bg = t.side === 'buy' ? '#e0483f' : '#1f9c8d'
      return chart.createOverlay({
        name: 'simpleAnnotation',
        points: [{ timestamp: dateToTs(t.tradeDate), value: t.price }],
        extendData: text,
        styles: {
          point: { color: bg, borderColor: bg, activeColor: bg, activeBorderColor: bg },
          text: {
            style: PolygonType.Fill,
            color: '#ffffff',
            backgroundColor: bg,
            borderColor: 'transparent',
            borderSize: 0,
            borderRadius: 2,
            size: 10,
          },
        },
      }) as string | null
    })
  }, [props.trades])

  // ---- 激活画线工具（onDrawEnd 收集完成的画线，需求 5.5.2；onSelected 支持单条删除） ----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !props.activeTool) return
    const onDrawEnd = (event: OverlayEvent) => {
      const overlay = event.overlay
      if (overlay) {
        propsRef.current.onOverlayComplete?.({
          toolType: overlay.name,
          pointsJson: JSON.stringify(overlay.points),
          styleJson: '{}',
          visible: true,
          overlayId: overlay.id,
        })
      }
      propsRef.current.onToolConsumed?.()
      return false
    }
    const onSelected = (event: OverlayEvent) => {
      propsRef.current.onOverlaySelected?.(event.overlay?.id ?? null)
      return true
    }
    const onDeselected = () => {
      propsRef.current.onOverlaySelected?.(null)
      return true
    }
    chart.createOverlay({
      name: props.activeTool,
      mode: OverlayMode.Normal,
      onDrawEnd,
      onSelected,
      onDeselected,
    })
  }, [props.activeTool])

  // ---- MA 周期切换（重建指标，每条线配色区分） ----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !props.maPeriods) return
    chart.removeIndicator('candle_pane', 'MA')
    chart.createIndicator(
      {
        name: 'MA',
        calcParams: props.maPeriods,
        styles: { lines: MA_COLORS.map((c) => MA_LINE(c)) },
      },
      false, { id: 'candle_pane' },
    )
  }, [props.maPeriods])

  // ---- 盲训：隐藏日期类信息；tooltip 固定左上、随十字光标更新（盲训时过滤时间行） ----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    // 自定义 tooltip：盲训只留 OHLC；非盲训带时间（显式覆盖，避免样式 merge 残留）
    const custom = (blind: boolean) => (data: CandleTooltipCustomCallbackData) => {
      const k = data.current
      const row = (title: string, v: number) => ({ title, value: v.toFixed(2) })
      const legends = [row('开', k.open), row('高', k.high), row('低', k.low), row('收', k.close)]
      if (!blind) {
        const d = new Date(k.timestamp)
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        legends.unshift({ title: '时间', value: date })
      }
      return legends
    }
    chart.setStyles({
      xAxis: { tickText: { show: !props.blindMode, color: '#8b93a7' } },
      crosshair: { vertical: { text: { show: !props.blindMode } } },
      candle: {
        tooltip: {
          showRule: TooltipShowRule.FollowCross,
          showType: TooltipShowType.Standard,
          custom: custom(!!props.blindMode),
        },
      },
      indicator: { tooltip: { showRule: TooltipShowRule.FollowCross, showType: TooltipShowType.Standard } },
    })
  }, [props.blindMode])

  // ---- 复盘还原画线 ----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !props.overlays) return
    for (const o of props.overlays) {
      if (!o.visible) continue
      try {
        chart.createOverlay({ name: o.toolType, points: JSON.parse(o.pointsJson) })
      } catch { /* 忽略个别无法还原的画线 */ }
    }
  }, [props.overlays])

  return <div ref={boxRef} className="kline-box" />
})

export default KlineChart

export { fmtDisp }
