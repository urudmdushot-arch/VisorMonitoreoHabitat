Add-Type -AssemblyName 'System.IO.Compression.FileSystem'
Add-Type -AssemblyName 'System.Xml.Linq'
Add-Type -AssemblyName 'System.Web.Extensions'

$csharp = @"
using System;
using System.IO;
using System.IO.Compression;
using System.Xml;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Globalization;
using System.Web.Script.Serialization;

public class AzRecord
{
    public string predio;
    public string licencia;
    public string expediente;
    public string nombre_proyecto;
    public string ad_zonal;
    public string fecha_inicio;
    public string fecha_emision;
    public string estado_tramite;
    public string estado_flujo;
    public string tipo_proyecto;
    public double area_bruta;
    public string profesional;
    public string tipo_licencia;
}

public class TraceFase1
{
    public bool tiene;
    public string expediente;
    public string entidad;
    public string fecha_emision;
    public string estado;
    public double area_bruta;
}

public class TraceFase2
{
    public bool tiene;
    public string licencia;
    public string ad_zonal;
    public string fecha_inicio;
    public string fecha_emision;
    public string estado_tramite;
    public string profesional;
    public double area_bruta;
}

public class TraceFase3
{
    public bool tiene;
    public string registro;
    public string certificado;
    public string resultado;
    public string etapa;
    public double area_declarada;
}

public class TraceItem
{
    public string expediente;
    public string nombre_proyecto;
    public string tipo_proyecto;
    public int fase_actual;
    public string estado_ciclo;
    public TraceFase1 fase1_ec;
    public TraceFase2 fase2_az;
    public TraceFase3 fase3_amc;
}

public class FastTraceabilityBuilder
{
    public static List<string> ReadSharedStrings(ZipArchive zip)
    {
        var list = new List<string>();
        var entry = zip.GetEntry("xl/sharedStrings.xml");
        if (entry == null) return list;

        using (var stream = entry.Open())
        using (var reader = XmlReader.Create(stream))
        {
            while (reader.Read())
            {
                if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "si")
                {
                    using (var sub = reader.ReadSubtree())
                    {
                        string text = "";
                        while (sub.Read())
                        {
                            if (sub.NodeType == XmlNodeType.Element && sub.LocalName == "t")
                            {
                                text += sub.ReadElementContentAsString();
                            }
                        }
                        list.Add(text);
                    }
                }
            }
        }
        return list;
    }

    private static string FormatDate(string val)
    {
        if (string.IsNullOrWhiteSpace(val)) return null;
        val = val.Trim();
        double oaDate;
        if (double.TryParse(val, NumberStyles.Any, CultureInfo.InvariantCulture, out oaDate))
        {
            if (oaDate > 30000 && oaDate < 60000)
            {
                try
                {
                    DateTime dt = DateTime.FromOADate(oaDate);
                    return dt.ToString("yyyy-MM-dd");
                }
                catch { }
            }
        }
        return val;
    }

    public static Dictionary<string, List<AzRecord>> LoadAzFile(string filePath, string tipoLicencia)
    {
        var dict = new Dictionary<string, List<AzRecord>>();
        using (var zip = ZipFile.OpenRead(filePath))
        {
            var strings = ReadSharedStrings(zip);
            var sheet = zip.GetEntry("xl/worksheets/sheet1.xml");
            if (sheet == null) return dict;

            using (var stream = sheet.Open())
            using (var reader = XmlReader.Create(stream))
            {
                int rIdx = 0;
                while (reader.Read())
                {
                    if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "row")
                    {
                        rIdx++;
                        if (rIdx == 1) continue;

                        using (var sub = reader.ReadSubtree())
                        {
                            var cells = new Dictionary<string, string>();
                            while (sub.Read())
                            {
                                if (sub.NodeType == XmlNodeType.Element && sub.LocalName == "c")
                                {
                                    string col = Regex.Replace(sub.GetAttribute("r") ?? "", @"\d+", "");
                                    string t = sub.GetAttribute("t") ?? "";
                                    using (var cSub = sub.ReadSubtree())
                                    {
                                        while (cSub.Read())
                                        {
                                            if (cSub.NodeType == XmlNodeType.Element && cSub.LocalName == "v")
                                            {
                                                string raw = cSub.ReadElementContentAsString();
                                                int idx;
                                                if (t == "s" && int.TryParse(raw, out idx) && idx >= 0 && idx < strings.Count) raw = strings[idx];
                                                cells[col] = raw.Trim();
                                            }
                                        }
                                    }
                                }
                            }

                            string predioRaw = cells.ContainsKey("A") ? cells["A"] : "";
                            if (string.IsNullOrWhiteSpace(predioRaw)) continue;
                            string cleanP = Regex.Replace(predioRaw, @"\.0$", "").Trim();

                            string lic = cells.ContainsKey("B") ? cells["B"] : "";
                            string exp = cells.ContainsKey("C") ? cells["C"] : "";
                            string proy = cells.ContainsKey("I") ? cells["I"] : "";
                            string zonal = cells.ContainsKey("L") ? cells["L"] : "";
                            string fIni = cells.ContainsKey("R") ? FormatDate(cells["R"]) : "";
                            string fEmi = cells.ContainsKey("S") ? FormatDate(cells["S"]) : "";
                            string est = cells.ContainsKey("T") ? cells["T"] : "";
                            string flujo = cells.ContainsKey("U") ? cells["U"] : "";
                            string tipoP = "";
                            if (cells.ContainsKey("Y")) tipoP = cells["Y"];
                            else if (cells.ContainsKey("X")) tipoP = cells["X"];

                            double area = 0;
                            if (cells.ContainsKey("Z")) double.TryParse(cells["Z"].Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out area);
                            else if (cells.ContainsKey("Y")) double.TryParse(cells["Y"].Replace(',', '.'), NumberStyles.Any, CultureInfo.InvariantCulture, out area);

                            string prof = "";
                            if (cells.ContainsKey("AB")) prof = cells["AB"];
                            else if (cells.ContainsKey("AA")) prof = cells["AA"];

                            var rec = new AzRecord
                            {
                                predio = cleanP,
                                licencia = lic,
                                expediente = exp,
                                nombre_proyecto = proy,
                                ad_zonal = zonal,
                                fecha_inicio = fIni,
                                fecha_emision = fEmi,
                                estado_tramite = est,
                                estado_flujo = flujo,
                                tipo_proyecto = tipoP,
                                area_bruta = area,
                                profesional = prof,
                                tipo_licencia = tipoLicencia
                            };

                            if (!dict.ContainsKey(cleanP)) dict[cleanP] = new List<AzRecord>();
                            dict[cleanP].Add(rec);
                        }
                    }
                }
            }
        }
        return dict;
    }

    private static string Norm(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        return Regex.Replace(s.ToUpperInvariant(), @"[^A-Z0-9]", "");
    }

    public static void ProcessAndSave(string jsonPath, string jsPath, string az20Path, string az10Path, string metricsPath)
    {
        Console.WriteLine("1. Cargando matrices AZ...");
        var az20 = LoadAzFile(az20Path, "LMU 20");
        var az10 = LoadAzFile(az10Path, "LMU 10");

        var allAz = new Dictionary<string, List<AzRecord>>();
        foreach (var kvp in az20) allAz[kvp.Key] = kvp.Value;
        foreach (var kvp in az10)
        {
            if (!allAz.ContainsKey(kvp.Key)) allAz[kvp.Key] = kvp.Value;
            else allAz[kvp.Key].AddRange(kvp.Value);
        }

        Console.WriteLine("2. Leyendo licencias_data.json...");
        string rawJson = File.ReadAllText(jsonPath, System.Text.Encoding.UTF8);
        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = int.MaxValue;
        var data = serializer.Deserialize<List<Dictionary<string, object>>>(rawJson);

        int totalTrazItems = 0;
        int fullFunnelItems = 0;
        int fase2Items = 0;
        int fase1Items = 0;

        foreach (var p in data)
        {
            string pKey = (p["predio"] ?? "").ToString().Trim();

            // 1. Attach licencias_az
            var azList = allAz.ContainsKey(pKey) ? allAz[pKey] : new List<AzRecord>();
            p["licencias_az"] = azList;
            p["total_licencias_az"] = azList.Count;

            // 2. Read EC and AMC arrays from p
            var ecCerts = new List<Dictionary<string, object>>();
            if (p.ContainsKey("certificados_ec") && p["certificados_ec"] != null)
            {
                var arr = p["certificados_ec"] as System.Collections.ArrayList;
                if (arr != null)
                {
                    foreach (var item in arr)
                    {
                        var dict = item as Dictionary<string, object>;
                        if (dict != null) ecCerts.Add(dict);
                    }
                }
            }

            var amcCerts = new List<Dictionary<string, object>>();
            if (p.ContainsKey("certificados_amc") && p["certificados_amc"] != null)
            {
                var arr = p["certificados_amc"] as System.Collections.ArrayList;
                if (arr != null)
                {
                    foreach (var item in arr)
                    {
                        var dict = item as Dictionary<string, object>;
                        if (dict != null) amcCerts.Add(dict);
                    }
                }
            }

            var trazList = new List<TraceItem>();
            var usedAz = new HashSet<int>();
            var usedAmc = new HashSet<int>();

            // Process EC
            foreach (var ec in ecCerts)
            {
                string ecExp = (ec.ContainsKey("expediente") && ec["expediente"] != null) ? ec["expediente"].ToString().Trim() : "";
                string ecExpNorm = ecExp.ToUpperInvariant();
                AzRecord matchAz = null;
                int matchAzIdx = -1;

                if (!string.IsNullOrEmpty(ecExpNorm))
                {
                    for (int i = 0; i < azList.Count; i++)
                    {
                        if (!usedAz.Contains(i))
                        {
                            string azExpNorm = (azList[i].expediente ?? "").Trim().ToUpperInvariant();
                            if (azExpNorm == ecExpNorm)
                            {
                                matchAz = azList[i];
                                matchAzIdx = i;
                                usedAz.Add(i);
                                break;
                            }
                        }
                    }
                }

                // Match AMC
                Dictionary<string, object> matchAmc = null;
                string ecProjNorm = Norm((ec.ContainsKey("proyecto") && ec["proyecto"] != null) ? ec["proyecto"].ToString() : "");
                string azProjNorm = matchAz != null ? Norm(matchAz.nombre_proyecto) : "";

                for (int j = 0; j < amcCerts.Count; j++)
                {
                    if (!usedAmc.Contains(j))
                    {
                        string amcProjNorm = Norm((amcCerts[j].ContainsKey("proyecto") && amcCerts[j]["proyecto"] != null) ? amcCerts[j]["proyecto"].ToString() : "");
                        bool isMatch = false;

                        if (amcCerts.Count == 1 && ecCerts.Count == 1)
                        {
                            isMatch = true;
                        }
                        else if (!string.IsNullOrEmpty(amcProjNorm))
                        {
                            if ((!string.IsNullOrEmpty(ecProjNorm) && (ecProjNorm.Contains(amcProjNorm) || amcProjNorm.Contains(ecProjNorm))) ||
                                (!string.IsNullOrEmpty(azProjNorm) && (azProjNorm.Contains(amcProjNorm) || amcProjNorm.Contains(azProjNorm))))
                            {
                                isMatch = true;
                            }
                        }

                        if (isMatch)
                        {
                            matchAmc = amcCerts[j];
                            usedAmc.Add(j);
                            break;
                        }
                    }
                }

                int faseActual = 1;
                string estadoCiclo = "Detenido en Fase 1 (Certificado EC)";
                if (matchAmc != null)
                {
                    faseActual = 3;
                    estadoCiclo = "Ciclo Constructivo Completo";
                    fullFunnelItems++;
                }
                else if (matchAz != null)
                {
                    faseActual = 2;
                    estadoCiclo = "En Fase 2 (LMU Emitida)";
                    fase2Items++;
                }
                else
                {
                    fase1Items++;
                }

                double ecArea = 0;
                if (ec.ContainsKey("area_bruta") && ec["area_bruta"] != null) double.TryParse(ec["area_bruta"].ToString(), out ecArea);

                var trace = new TraceItem
                {
                    expediente = !string.IsNullOrEmpty(ecExp) ? ecExp : "Sin expediente",
                    nombre_proyecto = (ec.ContainsKey("proyecto") && ec["proyecto"] != null && !string.IsNullOrEmpty(ec["proyecto"].ToString())) ? ec["proyecto"].ToString() : (matchAz != null ? matchAz.nombre_proyecto : (p.ContainsKey("nombre_proyecto") ? (p["nombre_proyecto"] ?? "").ToString() : "")),
                    tipo_proyecto = (ec.ContainsKey("tipo_proyecto") && ec["tipo_proyecto"] != null && !string.IsNullOrEmpty(ec["tipo_proyecto"].ToString())) ? ec["tipo_proyecto"].ToString() : (matchAz != null ? matchAz.tipo_proyecto : (p.ContainsKey("tipo_proyecto") ? (p["tipo_proyecto"] ?? "").ToString() : "")),
                    fase_actual = faseActual,
                    estado_ciclo = estadoCiclo,
                    fase1_ec = new TraceFase1
                    {
                        tiene = true,
                        expediente = ecExp,
                        entidad = (ec.ContainsKey("entidad") && ec["entidad"] != null) ? ec["entidad"].ToString() : "",
                        fecha_emision = (ec.ContainsKey("fecha_emision") && ec["fecha_emision"] != null) ? ec["fecha_emision"].ToString() : "",
                        estado = (ec.ContainsKey("estado") && ec["estado"] != null) ? ec["estado"].ToString() : "EMITIDO",
                        area_bruta = ecArea
                    },
                    fase2_az = matchAz != null ? new TraceFase2
                    {
                        tiene = true,
                        licencia = matchAz.licencia,
                        ad_zonal = matchAz.ad_zonal,
                        fecha_inicio = matchAz.fecha_inicio,
                        fecha_emision = matchAz.fecha_emision,
                        estado_tramite = matchAz.estado_tramite,
                        profesional = matchAz.profesional,
                        area_bruta = matchAz.area_bruta
                    } : null,
                    fase3_amc = matchAmc != null ? new TraceFase3
                    {
                        tiene = true,
                        registro = (matchAmc.ContainsKey("registro") && matchAmc["registro"] != null) ? matchAmc["registro"].ToString() : "",
                        certificado = (matchAmc.ContainsKey("certificado") && matchAmc["certificado"] != null) ? matchAmc["certificado"].ToString() : "",
                        resultado = (matchAmc.ContainsKey("resultado") && matchAmc["resultado"] != null) ? matchAmc["resultado"].ToString() : "FAVORABLE",
                        etapa = (matchAmc.ContainsKey("etapa") && matchAmc["etapa"] != null) ? matchAmc["etapa"].ToString() : "0",
                        area_declarada = matchAmc.ContainsKey("area_declarada") && matchAmc["area_declarada"] != null ? Convert.ToDouble(matchAmc["area_declarada"]) : 0
                    } : null
                };

                trazList.Add(trace);
                totalTrazItems++;
            }

            // Process remaining AZ
            for (int i = 0; i < azList.Count; i++)
            {
                if (!usedAz.Contains(i))
                {
                    usedAz.Add(i);
                    var az = azList[i];

                    // Match AMC
                    Dictionary<string, object> matchAmc = null;
                    string azProjNorm = Norm(az.nombre_proyecto);

                    for (int j = 0; j < amcCerts.Count; j++)
                    {
                        if (!usedAmc.Contains(j))
                        {
                            string amcProjNorm = Norm((amcCerts[j].ContainsKey("proyecto") && amcCerts[j]["proyecto"] != null) ? amcCerts[j]["proyecto"].ToString() : "");
                            bool isMatch = false;

                            if (amcCerts.Count == 1)
                            {
                                isMatch = true;
                            }
                            else if (!string.IsNullOrEmpty(amcProjNorm) && !string.IsNullOrEmpty(azProjNorm) && (azProjNorm.Contains(amcProjNorm) || amcProjNorm.Contains(azProjNorm)))
                            {
                                isMatch = true;
                            }

                            if (isMatch)
                            {
                                matchAmc = amcCerts[j];
                                usedAmc.Add(j);
                                break;
                            }
                        }
                    }

                    int faseActual = matchAmc != null ? 3 : 2;
                    string estadoCiclo = matchAmc != null ? "Ciclo Constructivo Completo" : "Directo en AZ (Licencia Emitida)";
                    if (matchAmc != null) fullFunnelItems++;
                    else fase2Items++;

                    var trace = new TraceItem
                    {
                        expediente = !string.IsNullOrEmpty(az.expediente) ? az.expediente : az.licencia,
                        nombre_proyecto = az.nombre_proyecto,
                        tipo_proyecto = az.tipo_proyecto,
                        fase_actual = faseActual,
                        estado_ciclo = estadoCiclo,
                        fase1_ec = null,
                        fase2_az = new TraceFase2
                        {
                            tiene = true,
                            licencia = az.licencia,
                            ad_zonal = az.ad_zonal,
                            fecha_inicio = az.fecha_inicio,
                            fecha_emision = az.fecha_emision,
                            estado_tramite = az.estado_tramite,
                            profesional = az.profesional,
                            area_bruta = az.area_bruta
                        },
                        fase3_amc = matchAmc != null ? new TraceFase3
                        {
                            tiene = true,
                            registro = (matchAmc.ContainsKey("registro") && matchAmc["registro"] != null) ? matchAmc["registro"].ToString() : "",
                            certificado = (matchAmc.ContainsKey("certificado") && matchAmc["certificado"] != null) ? matchAmc["certificado"].ToString() : "",
                            resultado = (matchAmc.ContainsKey("resultado") && matchAmc["resultado"] != null) ? matchAmc["resultado"].ToString() : "FAVORABLE",
                            etapa = (matchAmc.ContainsKey("etapa") && matchAmc["etapa"] != null) ? matchAmc["etapa"].ToString() : "0",
                            area_declarada = matchAmc.ContainsKey("area_declarada") && matchAmc["area_declarada"] != null ? Convert.ToDouble(matchAmc["area_declarada"]) : 0
                        } : null
                    };

                    trazList.Add(trace);
                    totalTrazItems++;
                }
            }

            // Process remaining AMC
            for (int j = 0; j < amcCerts.Count; j++)
            {
                if (!usedAmc.Contains(j))
                {
                    usedAmc.Add(j);
                    var amc = amcCerts[j];

                    var trace = new TraceItem
                    {
                        expediente = (amc.ContainsKey("registro") && amc["registro"] != null) ? amc["registro"].ToString() : "Control AMC",
                        nombre_proyecto = (amc.ContainsKey("proyecto") && amc["proyecto"] != null) ? amc["proyecto"].ToString() : "",
                        tipo_proyecto = (p.ContainsKey("tipo_proyecto") && p["tipo_proyecto"] != null) ? p["tipo_proyecto"].ToString() : "",
                        fase_actual = 3,
                        estado_ciclo = "Registrado en AMC (Control Posterior)",
                        fase1_ec = null,
                        fase2_az = null,
                        fase3_amc = new TraceFase3
                        {
                            tiene = true,
                            registro = (amc.ContainsKey("registro") && amc["registro"] != null) ? amc["registro"].ToString() : "",
                            certificado = (amc.ContainsKey("certificado") && amc["certificado"] != null) ? amc["certificado"].ToString() : "",
                            resultado = (amc.ContainsKey("resultado") && amc["resultado"] != null) ? amc["resultado"].ToString() : "FAVORABLE",
                            etapa = (amc.ContainsKey("etapa") && amc["etapa"] != null) ? amc["etapa"].ToString() : "0",
                            area_declarada = amc.ContainsKey("area_declarada") && amc["area_declarada"] != null ? Convert.ToDouble(amc["area_declarada"]) : 0
                        }
                    };
                    trazList.Add(trace);
                    totalTrazItems++;
                }
            }

            p["trazabilidad"] = trazList;
            p["total_expedientes"] = trazList.Count;
        }

        Console.WriteLine("3. Serializando y guardando dataset...");
        string updatedJson = serializer.Serialize(data);
        File.WriteAllText(jsonPath, updatedJson, new System.Text.UTF8Encoding(false));

        string metricasRaw = File.ReadAllText(metricsPath, System.Text.Encoding.UTF8);
        string jsBundle = "window.LICENCIAS_DATA = " + updatedJson + ";\nwindow.METRICAS_RESUMEN = " + metricasRaw + ";\n";
        File.WriteAllText(jsPath, jsBundle, new System.Text.UTF8Encoding(false));

        Console.WriteLine(string.Format("=== RESULTADOS GLOBALES DE TRAZABILIDAD ==="));
        Console.WriteLine(string.Format("Total items trazados (expedientes/licencias): {0}", totalTrazItems));
        Console.WriteLine(string.Format("Ciclos completos trazados: {0}", fullFunnelItems));
        Console.WriteLine(string.Format("Licencias en Fase 2 trazadas: {0}", fase2Items));
        Console.WriteLine(string.Format("Certificados en Fase 1 trazados: {0}", fase1Items));
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies "System.IO.Compression", "System.IO.Compression.FileSystem", "System.Xml", "System.Web.Extensions"

$jsonPath = (Resolve-Path 'public/data/licencias_data.json').Path
$jsPath = (Resolve-Path 'public/data/licencias_data.js').Path
$az20Path = (Resolve-Path 'ADMINISTRACIONES ZONALES LMU20_PURGADO.xlsx').Path
$az10Path = (Resolve-Path 'ADMINISTRACIONES ZONALES LMU10_PURGADO.xlsx').Path
$metricsPath = (Resolve-Path 'public/data/metricas_resumen.json').Path

$sw = [System.Diagnostics.Stopwatch]::StartNew()
[FastTraceabilityBuilder]::ProcessAndSave($jsonPath, $jsPath, $az20Path, $az10Path, $metricsPath)
$sw.Stop()
Write-Host "Completado en" $sw.ElapsedMilliseconds "ms"
