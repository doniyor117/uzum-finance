"""Extract published category rates from Uzum's commission and EDBS workbooks."""
import argparse
import json
from pathlib import Path

from openpyxl import load_workbook


def category_rows(sheet, first_row, columns):
    return {
        int(row[0]): ([v.strip() for v in row[2:8] if isinstance(v, str) and v.strip()],
                      [round(row[i] * 100, 6) if isinstance(row[i], (int, float)) and 0 <= row[i] <= 1 else None
                       for i in columns])
        for row in sheet.iter_rows(min_row=first_row, max_col=max(columns) + 1, values_only=True)
        if isinstance(row[0], (int, float)) and row[2]
    }


def appendix(sheet):
    return {
        (row[0].strip(), row[1].strip()): row[2]
        for row in sheet.iter_rows(min_row=4, max_col=3, values_only=True)
        if all(isinstance(v, str) and v.strip() for v in row[:2]) and row[2] is not None
    }


def merge(first, second, code):
    if first is not None and second is not None and first != second:
        raise ValueError(f'Conflicting bilingual rates for category {code}')
    return first if first is not None else second


parser = argparse.ArgumentParser()
parser.add_argument('commission')
parser.add_argument('edbs')
parser.add_argument('output', type=Path)
args = parser.parse_args()
workbook = load_workbook(args.commission, read_only=True, data_only=True)
edbs = load_workbook(args.edbs, read_only=True, data_only=True)
ru = category_rows(workbook['Комиссия на продажу'], 5, [14, 15, 16])
uz = category_rows(workbook['Savdo komissiyasi'], 5, [14, 15, 16])
edbs_ru = category_rows(edbs.worksheets[2], 4, [8])
edbs_uz = category_rows(edbs.worksheets[3], 4, [8])
reduced = [appendix(workbook['Приложение 1']), appendix(workbook['1-ilova'])]
grace = [appendix(workbook['Приложение 2']), appendix(workbook['2-ilova'])]
output = {}
for code in sorted(ru.keys() | uz.keys() | edbs_ru.keys() | edbs_uz.keys()):
    russian, r_rates = ru.get(code, ([], [None] * 3))
    uzbek, u_rates = uz.get(code, ([], [None] * 3))
    russian_ad, r_ad = edbs_ru.get(code, ([], [None]))
    uzbek_ad, u_ad = edbs_uz.get(code, ([], [None]))
    russian, uzbek = russian or russian_ad, uzbek or uzbek_ad
    pairs = [tuple(russian[:2]), tuple(uzbek[:2])]
    tariffs = [merge(r, u, code) for r, u in zip(r_rates, u_rates)]
    tariffs.append(merge(r_ad[0], u_ad[0], code))
    if all(rate is None for rate in tariffs):
        continue
    is_reduced = any(pair in table for pair, table in zip(pairs, reduced))
    free_days = max(table.get(pair, 30) for pair, table in zip(pairs, grace))
    output[code] = [' › '.join(uzbek), ' › '.join(russian), tariffs, int(is_reduced), free_days]
args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(output)} categories')
