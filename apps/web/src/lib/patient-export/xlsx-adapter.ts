import type { CellObject, SheetData } from 'write-excel-file/browser';
import { escapePatientExportTextForOoxml } from './ooxml';
import type { PatientExportWorkbook, PatientExportWorkbookCell } from './workbook';

export type PatientExportWritableSheet = {
	sheet: string;
	data: SheetData;
	columns: { width: number }[];
	stickyRowsCount: number;
	showGridLines: boolean;
};

const HEADER_STYLE = {
	fontWeight: 'bold' as const,
	textColor: '#FFFFFF',
	backgroundColor: '#0F766E',
	align: 'left' as const,
	alignVertical: 'center' as const,
	wrap: true,
	height: 28,
	bottomBorderColor: '#115E59',
	bottomBorderStyle: 'thin' as const
};

const DATA_STYLE = {
	alignVertical: 'top' as const,
	wrap: true
};

const headerCell = (value: string): CellObject => ({
	value: escapePatientExportTextForOoxml(value),
	type: String,
	...HEADER_STYLE
});

const workbookCell = (cell: PatientExportWorkbookCell): CellObject | null => {
	if (cell === null) return null;
	if (cell.kind === 'number') {
		return {
			value: cell.value,
			type: Number,
			align: 'right',
			alignVertical: 'top'
		};
	}
	return {
		value: escapePatientExportTextForOoxml(cell.value),
		type: String,
		...DATA_STYLE
	};
};

/**
 * Ultima frontera antes de OOXML: no se pasan strings primitivas ni Formula.
 * De ese modo la libreria no puede inferir formulas, fechas, IDs o telefonos.
 */
export const toPatientExportWritableSheets = (
	workbook: PatientExportWorkbook
): PatientExportWritableSheet[] =>
	workbook.sheets.map((sheet) => ({
		sheet: sheet.name,
		data: [sheet.headers.map(headerCell), ...sheet.rows.map((row) => row.map(workbookCell))],
		columns: sheet.widths.map((width) => ({ width })),
		stickyRowsCount: 1,
		showGridLines: true
	}));
