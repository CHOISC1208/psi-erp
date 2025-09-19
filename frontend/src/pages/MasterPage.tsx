import { useMemo } from "react";
import { useParams } from "react-router-dom";

interface MasterField {
  key: string;
  label: string;
  helper: string;
}

interface MasterConfig {
  title: string;
  description: string;
  fields: MasterField[];
}

const masterConfigs: Record<string, MasterConfig> = {
  products: {
    title: "Product Master",
    description: "Manage product catalog information including SKU, name, and stock control details.",
    fields: [
      { key: "sku", label: "SKU", helper: "Unique product identifier" },
      { key: "name", label: "Name", helper: "Display name" },
      { key: "category", label: "Category", helper: "Grouping for reporting" },
      { key: "safety_stock", label: "Safety Stock", helper: "Minimum quantity to keep on hand" },
    ],
  },
  customers: {
    title: "Customer Master",
    description: "Maintain customer records used for order and PSI planning.",
    fields: [
      { key: "code", label: "Customer Code", helper: "Unique customer reference" },
      { key: "name", label: "Name", helper: "Billing or trading name" },
      { key: "contact", label: "Contact", helper: "Primary contact information" },
      { key: "region", label: "Region", helper: "Sales territory" },
    ],
  },
  suppliers: {
    title: "Supplier Master",
    description: "Define suppliers that provide materials feeding the PSI calculations.",
    fields: [
      { key: "code", label: "Supplier Code", helper: "Unique supplier reference" },
      { key: "name", label: "Name", helper: "Supplier name" },
      { key: "lead_time", label: "Lead Time", helper: "Average delivery lead time in days" },
      { key: "currency", label: "Currency", helper: "Default purchasing currency" },
    ],
  },
};

export default function MasterPage() {
  const { masterId } = useParams<{ masterId: string }>();

  const config = useMemo(() => {
    if (!masterId) return undefined;
    return masterConfigs[masterId];
  }, [masterId]);

  if (!config) {
    return (
      <div className="page">
        <header>
          <h1>Masters</h1>
          <p>Select a master from the sidebar to view its configuration guidance.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="page master-page">
      <header>
        <h1>{config.title}</h1>
        <p>{config.description}</p>
      </header>

      <section>
        <h2>Key Fields</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {config.fields.map((field) => (
              <tr key={field.key}>
                <td>{field.label}</td>
                <td>{field.helper}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Management Tips</h2>
        <ul className="master-guidance">
          <li>Keep master data synchronized with external systems to ensure accurate PSI calculations.</li>
          <li>Review and audit records regularly to remove obsolete entries.</li>
          <li>Use consistent coding standards across masters for easier integration.</li>
        </ul>
      </section>
    </div>
  );
}
