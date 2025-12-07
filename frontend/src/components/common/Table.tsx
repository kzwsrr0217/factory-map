import React from 'react';
import styles from '../../styles/components/Table.module.css';

interface Column<T> {
  key: string;
  title: string;
  render?: (value: any, record: T) => React.ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  onRowClick?: (record: T) => void;
}

function Table<T extends { _id?: string }>({
  columns,
  data,
  loading = false,
  onRowClick,
}: TableProps<T>) {
  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No data available</p>
      </div>
    );
  }

  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((record, index) => (
            <tr
              key={record._id || index}
              onClick={() => onRowClick?.(record)}
              className={onRowClick ? styles.clickable : ''}
            >
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render
                    ? column.render((record as any)[column.key], record)
                    : (record as any)[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Table;