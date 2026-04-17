export type DashboardKpiCard = {
  label: string;
  value: string;
  detail: string;
};

export function DashboardKpiGrid({ cards }: { cards: DashboardKpiCard[] }) {
  return (
    <div className="module-summary-grid cols-4">
      {cards.map((card) => (
        <div key={card.label} className="module-summary-card">
          <p className="module-summary-label">{card.label}</p>
          <p className="module-summary-value">{card.value}</p>
          <p className="module-summary-detail">{card.detail}</p>
        </div>
      ))}
    </div>
  );
}
