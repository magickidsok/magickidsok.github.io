using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MagicKidsPanel;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

sealed class VideoItem
{
    public int ServerId { get; set; }
    public string SourcePath { get; set; } = "";
    public string Title { get; set; } = "";
    public string Category { get; set; } = "SERIES";
    public int CategoryId { get; set; }
    public string Status { get; set; } = "EN COLA";
    public double DurationSeconds { get; set; }
    public long SizeBytes { get; set; }
    public int Order { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

sealed class LocalStore { public List<VideoItem> Videos { get; set; } = new(); }

sealed class LoginResponse { public string Token { get; set; } = ""; }
sealed class InitResponse { public string Key { get; set; } = ""; public string UploadId { get; set; } = ""; }
sealed class CompleteResponse { public int? Id { get; set; } public string Key { get; set; } = ""; public string Title { get; set; } = ""; }
sealed class CategoryDto { public int Id { get; set; } public string Name { get; set; } = ""; }
sealed class ChannelState
{
    public string Status { get; set; } = "stopped";
    public long Generation { get; set; }
    public long StartedAt { get; set; }
    public int CurrentIndex { get; set; }
    public double PositionSeconds { get; set; }
    public double PausedPosition { get; set; }
    public int PausedIndex { get; set; }
}
sealed class ViewerResponse { public int Count { get; set; } }
sealed class StorageResponse
{
    public long LimitBytes { get; set; }
    public long UsedBytes { get; set; }
    public long FreeBytes { get; set; }
    public double PercentUsed { get; set; }
    public int Objects { get; set; }
}
sealed class VideoDto
{
    public int Id { get; set; }
    public string ObjectKey { get; set; } = "";
    public string Title { get; set; } = "";
    public int? CategoryId { get; set; }
    public string Category { get; set; } = "";
    public string VideoType { get; set; } = "";
    public double DurationSeconds { get; set; }
    public long CreatedAt { get; set; }
}

static class LocalDb
{
    static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MagicKidsPanel");
    static string DataPath => Path.Combine(Root, "library.json");
    static JsonSerializerOptions Opt => new() { WriteIndented = true, PropertyNameCaseInsensitive = true };

    public static void Ensure() => Directory.CreateDirectory(Root);

    public static LocalStore Load()
    {
        Ensure();
        try { return JsonSerializer.Deserialize<LocalStore>(File.ReadAllText(DataPath), Opt) ?? new(); }
        catch { return new(); }
    }

    public static void Save(LocalStore store)
    {
        Ensure();
        var tmp = DataPath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(store, Opt), Encoding.UTF8);
        File.Move(tmp, DataPath, true);
    }
}

static class Mp4DurationReader
{
    static readonly byte[] Marker = Encoding.ASCII.GetBytes("mvhd");

    public static double ReadSeconds(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, true);
            const int chunk = 8 * 1024 * 1024;
            var first = new byte[Math.Min(chunk, fs.Length)];
            fs.ReadExactly(first);
            var found = TryRead(first);
            if (found > 0) return found;

            if (fs.Length > chunk)
            {
                var size = (int)Math.Min(chunk, fs.Length);
                fs.Seek(-size, SeekOrigin.End);
                var last = new byte[size];
                fs.ReadExactly(last);
                found = TryRead(last);
                if (found > 0) return found;
            }
        }
        catch { }
        return 0;
    }

    static double TryRead(byte[] data)
    {
        for (var i = 0; i <= data.Length - Marker.Length; i++)
        {
            if (data[i] != (byte)'m' || data[i + 1] != (byte)'v' || data[i + 2] != (byte)'h' || data[i + 3] != (byte)'d')
                continue;

            if (i + 24 >= data.Length) continue;
            var version = data[i + 4];
            try
            {
                if (version == 0 && i + 24 <= data.Length)
                {
                    var scale = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(i + 16, 4));
                    var duration = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(i + 20, 4));
                    if (scale > 0 && duration > 0) return duration / (double)scale;
                }
                else if (version == 1 && i + 40 <= data.Length)
                {
                    var scale = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(i + 28, 4));
                    var duration = System.Buffers.Binary.BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(i + 32, 8));
                    if (scale > 0 && duration > 0) return duration / (double)scale;
                }
            }
            catch { }
        }
        return 0;
    }
}

sealed class MagicCloud
{
    const string Base = "https://magickidsok-github-io.elmagickids.workers.dev";
    const string PanelToken = "MKPANEL-7X4D-92QF-8N3L-6V2Z-4K7P";

    readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(30) };
    string adminToken = "";

    public string M3u8Url => Base + "/magic-kids-live.m3u8";

    async Task<JsonElement> Send(string path, HttpMethod method, object? body = null, HttpContent? content = null, bool auth = true, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(method, Base + path);
        if (auth && !string.IsNullOrWhiteSpace(adminToken))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        if (body is not null)
            req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        else if (content is not null)
            req.Content = content;

        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Cloudflare Worker HTTP {(int)res.StatusCode}: {text}");
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    public async Task<bool> Connect(CancellationToken ct = default)
    {
        try
        {
            var health = await Send("/api/health", HttpMethod.Get, auth: false, ct: ct);
            var loginReq = new HttpRequestMessage(HttpMethod.Post, Base + "/api/admin/link-login");
            loginReq.Headers.TryAddWithoutValidation("X-MK-PANEL-TOKEN", PanelToken);
            using var loginRes = await http.SendAsync(loginReq, HttpCompletionOption.ResponseHeadersRead, ct);
            var loginText = await loginRes.Content.ReadAsStringAsync(ct);
            if (!loginRes.IsSuccessStatusCode) return false;
            var login = JsonSerializer.Deserialize<LoginResponse>(loginText, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            adminToken = login?.Token ?? "";
            return !string.IsNullOrWhiteSpace(adminToken);
        }
        catch { return false; }
    }

    public async Task<List<CategoryDto>> Categories(CancellationToken ct = default)
    {
        var d = await Send("/api/admin/categories", HttpMethod.Get, ct: ct);
        return d.GetProperty("categories").Deserialize<List<CategoryDto>>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }

    public async Task<CategoryDto> CreateCategory(string name, CancellationToken ct = default)
    {
        var d = await Send("/api/admin/categories", HttpMethod.Post, new { name }, ct: ct);
        var list = d.GetProperty("categories").Deserialize<List<CategoryDto>>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
        return list.First(x => x.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
    }

    public async Task<List<VideoDto>> Videos(CancellationToken ct = default)
    {
        var d = await Send("/api/videos", HttpMethod.Get, ct: ct);
        return d.GetProperty("videos").Deserialize<List<VideoDto>>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }

    public async Task<StorageResponse> Storage(CancellationToken ct = default)
    {
        var d = await Send("/api/admin/storage", HttpMethod.Get, ct: ct);
        return d.Deserialize<StorageResponse>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }

    public async Task<int> Viewers(CancellationToken ct = default)
    {
        var d = await Send("/api/admin/viewers", HttpMethod.Get, ct: ct);
        return d.TryGetProperty("count", out var c) ? c.GetInt32() : 0;
    }

    public async Task<ChannelState> ChannelState(CancellationToken ct = default)
    {
        var d = await Send("/api/channel/state", HttpMethod.Get, ct: ct);
        return d.Deserialize<ChannelState>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }

    public async Task<ChannelState> ChannelAction(string action, CancellationToken ct = default)
    {
        var d = await Send("/api/admin/channel", HttpMethod.Post, new { action }, ct: ct);
        return d.GetProperty("state").Deserialize<ChannelState>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }

    public async Task Schedule(List<int> ids, CancellationToken ct = default)
    {
        var items = ids.Select(id => new { videoId = id, startTime = "00:00" }).ToArray();
        await Send("/api/admin/schedule", HttpMethod.Post, new { items }, ct: ct);
    }

    public async Task<List<int>> ExistingScheduledIds(CancellationToken ct = default)
    {
        var d = await Send("/api/admin/schedule", HttpMethod.Get, ct: ct);
        var rows = d.GetProperty("schedule");
        return rows.EnumerateArray().Select(x => x.GetProperty("video_id").GetInt32()).ToList();
    }

    public async Task<(string Key, string UploadId)> Initiate(string fileName, string contentType, CancellationToken ct)
    {
        var d = await Send("/api/admin/upload/initiate", HttpMethod.Post, new { name = fileName, contentType }, ct: ct);
        return (d.GetProperty("key").GetString() ?? "", d.GetProperty("uploadId").GetString() ?? "");
    }

    public async Task<string> UploadPart(string key, string uploadId, int partNumber, Stream stream, long contentLength, CancellationToken ct)
    {
        using var content = new StreamContent(stream, 1024 * 1024);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        content.Headers.ContentLength = contentLength;

        using var req = new HttpRequestMessage(HttpMethod.Put, Base + "/api/admin/upload/part?key=" + Uri.EscapeDataString(key) + "&uploadId=" + Uri.EscapeDataString(uploadId) + "&partNumber=" + partNumber);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        req.Content = content;
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(text);
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty("part").GetProperty("etag").GetString() ?? "";
    }

    public async Task<CompleteResponse> Complete(string key, string uploadId, IEnumerable<(int Number, string Etag)> parts, string title, int categoryId, double duration, CancellationToken ct)
    {
        var body = new
        {
            key,
            uploadId,
            parts = parts.Select(p => new { partNumber = p.Number, etag = p.Etag }).ToArray(),
            title,
            categoryId,
            durationSeconds = duration,
            videoType = "program"
        };
        var d = await Send("/api/admin/upload/complete", HttpMethod.Post, body, ct: ct);
        return d.Deserialize<CompleteResponse>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }

    public async Task DeleteVideo(int id, CancellationToken ct = default)
    {
        await Send("/api/admin/video/delete", HttpMethod.Post, new { id }, ct: ct);
    }
}

sealed class MainForm : Form
{
    static readonly Color Bg = Color.FromArgb(7, 3, 31);
    static readonly Color Card = Color.FromArgb(16, 8, 52);
    static readonly Color Purple = Color.FromArgb(117, 54, 255);
    static readonly Color Green = Color.FromArgb(27, 163, 91);
    static readonly Color Red = Color.FromArgb(185, 44, 55);
    static readonly Color Amber = Color.FromArgb(152, 111, 18);
    static readonly Color GrayButton = Color.FromArgb(53, 44, 80);

    readonly MagicCloud cloud = new();
    readonly LocalStore store = LocalDb.Load();
    readonly TabControl tabs = new();
    readonly DataGridView programGrid = new();
    readonly Label connLabel = new();
    readonly Label viewersLabel = new();
    readonly Label storageLabel = new();
    readonly Label channelLabel = new();
    readonly Label m3uLabel = new();
    readonly Label activityLabel = new();
    readonly ProgressBar uploadProgress = new();
    readonly Dictionary<string, Button> actionButtons = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, DataGridView> categoryGrids = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, int> categoryIds = new(StringComparer.OrdinalIgnoreCase);
    CancellationTokenSource? uploadCts;
    Timer? refreshTimer;

    public MainForm()
    {
        Text = "MAGIC KIDS — PANEL PRIVADO";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 1250;
        Height = 820;
        MinimumSize = new Size(1050, 700);
        BackColor = Bg;
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 9F);
        BuildUi();
        Load += async (_, _) => await InitializeAsync();
        FormClosing += (_, _) => uploadCts?.Cancel();
    }

    Button MakeButton(string key, string text, Color color, Func<Task> action, int width = 145)
    {
        var b = new Button
        {
            Name = key,
            Text = text,
            Width = width,
            Height = 44,
            BackColor = color,
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
            Margin = new Padding(4)
        };
        b.FlatAppearance.BorderSize = 0;
        b.Click += async (_, _) =>
        {
            b.Enabled = false;
            try
            {
                await action();
                FlashSuccess(b);
            }
            catch (Exception ex)
            {
                activityLabel.Text = "ERROR: " + ex.Message;
                activityLabel.ForeColor = Color.OrangeRed;
            }
            finally { b.Enabled = true; }
        };
        actionButtons[key] = b;
        return b;
    }

    void FlashSuccess(Button b)
    {
        var old = b.BackColor;
        b.BackColor = Green;
        var t = new Timer { Interval = 700 };
        t.Tick += (_, _) => { t.Stop(); t.Dispose(); b.BackColor = old; };
        t.Start();
    }

    void BuildUi()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1, BackColor = Bg };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 88));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        Controls.Add(root);

        var header = new Panel { Dock = DockStyle.Fill, BackColor = Bg };
        header.Controls.Add(new Label { Text = "MAGIC KIDS", ForeColor = Color.FromArgb(255, 210, 27), Font = new Font("Segoe UI", 24, FontStyle.Bold), AutoSize = true, Location = new Point(18, 7) });
        header.Controls.Add(new Label { Text = "PANEL PRIVADO · CLOUDFLARE R2 · SIN PIN · SIN NAVEGADOR", ForeColor = Color.Gainsboro, AutoSize = true, Location = new Point(20, 43) });
        connLabel.Text = "CLOUDFLARE R2: CONECTANDO…";
        connLabel.ForeColor = Color.Gold;
        connLabel.AutoSize = true;
        connLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        connLabel.Location = new Point(980, 20);
        header.Controls.Add(connLabel);
        root.Controls.Add(header, 0, 0);

        var control = new FlowLayoutPanel { Dock = DockStyle.Fill, BackColor = Card, Padding = new Padding(10, 9, 10, 8), WrapContents = false, AutoScroll = true };
        control.Controls.Add(MakeButton("start", "▶ INICIAR", Green, () => Channel("start")));
        control.Controls.Add(MakeButton("stop", "■ STOP", Red, () => Channel("stop")));
        control.Controls.Add(MakeButton("offair", "▣ FUERA DE AIRE", GrayButton, () => Channel("offair"), 165));
        control.Controls.Add(MakeButton("restart", "↻ REINICIAR", Purple, () => Channel("restart")));
        control.Controls.Add(MakeButton("pause", "Ⅱ PAUSAR", Amber, () => Channel("pause")));
        control.Controls.Add(MakeButton("resume", "▶ REANUDAR", Green, () => Channel("resume"), 150));
        channelLabel.Text = "ESTADO: DETENIDO";
        channelLabel.AutoSize = true; channelLabel.Font = new Font("Segoe UI", 10, FontStyle.Bold); channelLabel.Margin = new Padding(18, 17, 0, 0);
        control.Controls.Add(channelLabel);
        viewersLabel.Text = "👥 0 VIENDO"; viewersLabel.AutoSize = true; viewersLabel.Margin = new Padding(18, 17, 0, 0);
        control.Controls.Add(viewersLabel);
        root.Controls.Add(control, 0, 1);

        tabs.Dock = DockStyle.Fill;
        tabs.Multiline = false;
        tabs.Appearance = TabAppearance.Normal;
        AddCategoryTab("TANDAS");
        AddCategoryTab("SERIES");
        AddCategoryTab("PELICULAS");
        AddProgramTab();
        AddInfoTab();
        root.Controls.Add(tabs, 0, 2);

        var bottom = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 3, BackColor = Card, Padding = new Padding(12, 6, 12, 6) };
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 250));
        bottom.Controls.Add(new Label { Text = "ACTIVIDAD", ForeColor = Color.FromArgb(255, 210, 27), AutoSize = true }, 0, 0);
        activityLabel.Text = "Listo.";
        activityLabel.ForeColor = Color.Gainsboro;
        bottom.Controls.Add(activityLabel, 0, 1);
        uploadProgress.Dock = DockStyle.Fill;
        uploadProgress.Minimum = 0; uploadProgress.Maximum = 100;
        bottom.Controls.Add(uploadProgress, 0, 2);
        storageLabel.Text = "R2: 10 GB";
        storageLabel.ForeColor = Color.Gainsboro;
        storageLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        bottom.Controls.Add(storageLabel, 1, 0);
        root.Controls.Add(bottom, 0, 3);
    }

    void AddCategoryTab(string category)
    {
        var page = new TabPage(category) { BackColor = Bg, ForeColor = Color.White, Padding = new Padding(7) };
        var bar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 58, WrapContents = false, AutoScroll = true };
        var grid = CreateGrid(category);
        categoryGrids[category] = grid;

        bar.Controls.Add(MakeButton("add-" + category, "＋ AGREGAR VIDEOS", Purple, () => AddFiles(category), 175));
        bar.Controls.Add(MakeButton("upload-" + category, "⬆ SUBIR SELECCIONADOS", Green, () => UploadSelected(category), 205));
        bar.Controls.Add(MakeButton("up-" + category, "▲ SUBIR ORDEN", GrayButton, () => MoveSelected(category, -1), 145));
        bar.Controls.Add(MakeButton("down-" + category, "▼ BAJAR ORDEN", GrayButton, () => MoveSelected(category, 1), 145));
        bar.Controls.Add(MakeButton("remove-" + category, "✕ ELIMINAR", Red, () => DeleteSelected(category), 125));

        page.Controls.Add(grid);
        page.Controls.Add(bar);
        tabs.TabPages.Add(page);
    }

    DataGridView CreateGrid(string category)
    {
        var g = new DataGridView
        {
            Dock = DockStyle.Fill,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false,
            AutoGenerateColumns = false,
            BackgroundColor = Bg,
            ForeColor = Color.White,
            GridColor = Color.FromArgb(54, 38, 105),
            BorderStyle = BorderStyle.FixedSingle,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            MultiSelect = true,
            ReadOnly = true,
            RowHeadersVisible = false,
            Font = new Font("Segoe UI", 9.5F),
            RowTemplate = { Height = 30 },
            Tag = category
        };
        g.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(26, 16, 67);
        g.ColumnHeadersDefaultCellStyle.ForeColor = Color.White;
        g.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
        g.EnableHeadersVisualStyles = false;
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "order", HeaderText = "#", Width = 52 });
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "title", HeaderText = "VIDEO", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "status", HeaderText = "ESTADO", Width = 150 });
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "size", HeaderText = "TAMAÑO", Width = 100 });
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "duration", HeaderText = "DURACIÓN", Width = 95 });
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "serverId", HeaderText = "R2 ID", Width = 75 });
        g.SelectionChanged += (_, _) => UpdateActivityFromSelection(g);
        return g;
    }

    void AddProgramTab()
    {
        var page = new TabPage("PROGRAMACIÓN") { BackColor = Bg, ForeColor = Color.White, Padding = new Padding(7) };
        var bar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 58, WrapContents = false, AutoScroll = true };
        bar.Controls.Add(MakeButton("program-up", "▲ SUBIR", Purple, () => MoveProgramSelected(-1), 120));
        bar.Controls.Add(MakeButton("program-down", "▼ BAJAR", Purple, () => MoveProgramSelected(1), 120));
        bar.Controls.Add(MakeButton("program-save", "💾 GUARDAR PROGRAMACIÓN", Green, SaveSchedule, 215));
        bar.Controls.Add(MakeButton("program-refresh", "⟳ ACTUALIZAR", GrayButton, RefreshAll, 140));

        programGrid.Dock = DockStyle.Fill;
        programGrid.BackgroundColor = Bg;
        programGrid.ForeColor = Color.White;
        programGrid.GridColor = Color.FromArgb(54, 38, 105);
        programGrid.BorderStyle = BorderStyle.FixedSingle;
        programGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        programGrid.MultiSelect = true;
        programGrid.ReadOnly = true;
        programGrid.RowHeadersVisible = false;
        programGrid.AutoGenerateColumns = false;
        programGrid.RowTemplate.Height = 30;
        programGrid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(26, 16, 67);
        programGrid.ColumnHeadersDefaultCellStyle.ForeColor = Color.White;
        programGrid.EnableHeadersVisualStyles = false;
        programGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "porder", HeaderText = "#", Width = 52 });
        programGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "ptitle", HeaderText = "PROGRAMACIÓN", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });
        programGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "pcat", HeaderText = "SECCIÓN", Width = 110 });
        programGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "pstate", HeaderText = "ESTADO", Width = 130 });
        programGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "pduration", HeaderText = "DURACIÓN", Width = 95 });

        var footer = new Panel { Dock = DockStyle.Bottom, Height = 62 };
        m3uLabel.Text = "M3U8 PERMANENTE: " + cloud.M3u8Url;
        m3uLabel.ForeColor = Color.Gainsboro;
        m3uLabel.AutoEllipsis = true;
        m3uLabel.Dock = DockStyle.Top;
        var copy = MakeButton("copy-m3u", "COPIAR M3U8", Purple, async () => { Clipboard.SetText(cloud.M3u8Url); activityLabel.Text = "✓ M3U8 copiada."; await Task.CompletedTask; }, 145);
        copy.Dock = DockStyle.Right; copy.Margin = new Padding(0);
        footer.Controls.Add(copy);
        footer.Controls.Add(m3uLabel);

        page.Controls.Add(programGrid);
        page.Controls.Add(bar);
        page.Controls.Add(footer);
        tabs.TabPages.Add(page);
    }

    void AddInfoTab()
    {
        var page = new TabPage("ESTADO / R2") { BackColor = Bg, ForeColor = Color.White, Padding = new Padding(15) };
        var text = new Label
        {
            Dock = DockStyle.Top,
            AutoSize = false,
            Height = 250,
            ForeColor = Color.Gainsboro,
            Font = new Font("Segoe UI", 11F),
            Text = "MAGIC KIDS\n\nALMACENAMIENTO: Cloudflare R2\nBUCKET: magic-kids-videos\nCAPACIDAD CONTROLADA: 10 GB\nSIN PIN · SIN CHROME · SIN NAVEGADOR\n\nLa PC solo administra el canal. Los videos permanecen en R2 y la programación/estado quedan en la nube, por lo que la transmisión puede continuar aunque el programa se cierre o la PC se apague.\n\nM3U8: " + cloud.M3u8Url
        };
        page.Controls.Add(text);
        tabs.TabPages.Add(page);
    }

    async Task InitializeAsync()
    {
        try
        {
            if (!await cloud.Connect())
                throw new Exception("No se pudo conectar al Worker de Cloudflare.");
            connLabel.Text = "CLOUDFLARE R2: ONLINE";
            connLabel.ForeColor = Color.LightGreen;

            await EnsureCategories();
            await RefreshAll();
            StartRefreshTimer();
            await Channel("state");
        }
        catch (Exception ex)
        {
            connLabel.Text = "CLOUDFLARE R2: ERROR";
            connLabel.ForeColor = Color.OrangeRed;
            activityLabel.Text = ex.Message;
        }
    }

    async Task EnsureCategories()
    {
        var remote = await cloud.Categories();
        foreach (var name in new[] { "Tandas", "Series", "Peliculas" })
        {
            var hit = remote.FirstOrDefault(x => x.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
            if (hit is null) hit = await cloud.CreateCategory(name);
            categoryIds[name.ToUpperInvariant()] = hit.Id;
        }
    }

    async Task AddFiles(string category)
    {
        using var dlg = new OpenFileDialog
        {
            Multiselect = true,
            Filter = "Videos|*.mp4;*.mov;*.m4v;*.webm;*.mkv|Todos|*.*",
            Title = "Seleccionar videos para " + category
        };
        if (dlg.ShowDialog() != DialogResult.OK) return;

        foreach (var path in dlg.FileNames)
        {
            var info = new FileInfo(path);
            var existing = store.Videos.Any(v => string.Equals(v.SourcePath, path, StringComparison.OrdinalIgnoreCase));
            if (existing) continue;
            store.Videos.Add(new VideoItem
            {
                SourcePath = path,
                Title = Path.GetFileNameWithoutExtension(path),
                Category = category.ToUpperInvariant(),
                CategoryId = categoryIds[category.ToUpperInvariant()],
                SizeBytes = info.Length,
                DurationSeconds = Mp4DurationReader.ReadSeconds(path),
                Status = "EN COLA",
                Order = store.Videos.Count
            });
        }
        NormalizeOrder();
        LocalDb.Save(store);
        RefreshUi();
        activityLabel.Text = $"✓ {dlg.FileNames.Length} video(s) agregados a {category}.";
    }

    async Task UploadSelected(string category)
    {
        var grid = categoryGrids[category];
        var selected = grid.SelectedRows.Cast<DataGridViewRow>()
            .Select(r => r.Tag as VideoItem)
            .Where(v => v is not null && v.ServerId == 0 && File.Exists(v.SourcePath))
            .Cast<VideoItem>()
            .ToList();

        if (!selected.Any())
        {
            activityLabel.Text = "Seleccioná uno o más videos en la grilla para subir.";
            return;
        }

        uploadCts?.Cancel();
        uploadCts = new CancellationTokenSource();
        var ct = uploadCts.Token;
        var semaphore = new SemaphoreSlim(3);

        activityLabel.Text = $"Subiendo {selected.Count} video(s) en paralelo a Cloudflare R2…";
        uploadProgress.Value = 0;
        try
        {
            var tasks = selected.Select(async video =>
            {
                await semaphore.WaitAsync(ct);
                try { await UploadOne(video, ct); }
                finally { semaphore.Release(); }
            });
            await Task.WhenAll(tasks);
            NormalizeOrder();
            LocalDb.Save(store);
            await SaveSchedule();
            await RefreshAll();
            activityLabel.Text = "✓ Subida múltiple terminada.";
            uploadProgress.Value = 100;
        }
        finally { semaphore.Dispose(); }
    }

    async Task UploadOne(VideoItem v, CancellationToken ct)
    {
        v.Status = "INICIANDO…"; RefreshUi();
        var (key, uploadId) = await cloud.Initiate(Path.GetFileName(v.SourcePath), GetContentType(v.SourcePath), ct);

        const int partSize = 16 * 1024 * 1024;
        var parts = new List<(int Number, string Etag)>();
        var fi = new FileInfo(v.SourcePath);
        var total = fi.Length;
        long sent = 0;
        var partNo = 1;

        await using var fs = new FileStream(v.SourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, true);
        while (sent < total)
        {
            ct.ThrowIfCancellationRequested();
            var bytes = (int)Math.Min(partSize, total - sent);
            var buffer = new byte[bytes];
            var read = 0;
            while (read < bytes)
            {
                var n = await fs.ReadAsync(buffer.AsMemory(read, bytes - read), ct);
                if (n == 0) break;
                read += n;
            }
            using var ms = new MemoryStream(buffer, 0, read, writable: false);
            v.Status = $"SUBIENDO {Math.Round((sent + read) * 100.0 / total)}%";
            RefreshUi();
            var etag = await cloud.UploadPart(key, uploadId, partNo, ms, read, ct);
            parts.Add((partNo, etag));
            sent += read;
            uploadProgress.Value = Math.Min(100, (int)Math.Round(sent * 100.0 / total));
            partNo++;
        }

        v.Status = "FINALIZANDO…"; RefreshUi();
        var done = await cloud.Complete(key, uploadId, parts, v.Title, v.CategoryId, v.DurationSeconds, ct);
        v.ServerId = done.Id ?? 0;
        v.Status = v.DurationSeconds > 0 ? "LISTO" : "LISTO · DURACIÓN NO DETECTADA";
        activityLabel.Text = "✓ " + v.Title + " subido a Cloudflare R2.";
    }

    async Task DeleteSelected(string category)
    {
        var grid = categoryGrids[category];
        var selected = grid.SelectedRows.Cast<DataGridViewRow>().Select(r => r.Tag as VideoItem).Where(v => v is not null).Cast<VideoItem>().ToList();
        if (!selected.Any()) return;

        if (MessageBox.Show($"¿Eliminar {selected.Count} video(s) también del almacenamiento R2?", "MAGIC KIDS", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
            return;

        foreach (var v in selected)
        {
            if (v.ServerId > 0) await cloud.DeleteVideo(v.ServerId);
            store.Videos.Remove(v);
        }
        NormalizeOrder();
        LocalDb.Save(store);
        await SaveSchedule();
        await RefreshAll();
        activityLabel.Text = "✓ Videos eliminados.";
    }

    async Task MoveSelected(string category, int direction)
    {
        var selected = categoryGrids[category].SelectedRows.Cast<DataGridViewRow>()
            .Select(r => r.Tag as VideoItem).Where(v => v is not null).Cast<VideoItem>()
            .OrderBy(v => direction < 0 ? v.Order : -v.Order).ToList();
        foreach (var v in selected)
        {
            var i = store.Videos.IndexOf(v);
            var j = i + direction;
            if (j < 0 || j >= store.Videos.Count) continue;
            (store.Videos[i], store.Videos[j]) = (store.Videos[j], store.Videos[i]);
        }
        NormalizeOrder();
        LocalDb.Save(store);
        RefreshUi();
        await SaveSchedule();
    }

    async Task MoveProgramSelected(int direction)
    {
        var selected = programGrid.SelectedRows.Cast<DataGridViewRow>()
            .Select(r => r.Tag as VideoItem).Where(v => v is not null).Cast<VideoItem>()
            .OrderBy(v => direction < 0 ? v.Order : -v.Order).ToList();
        foreach (var v in selected)
        {
            var i = store.Videos.IndexOf(v);
            var j = i + direction;
            if (j < 0 || j >= store.Videos.Count) continue;
            (store.Videos[i], store.Videos[j]) = (store.Videos[j], store.Videos[i]);
        }
        NormalizeOrder();
        LocalDb.Save(store);
        RefreshUi();
    }

    async Task SaveSchedule()
    {
        var ids = store.Videos.Where(v => v.ServerId > 0).OrderBy(v => v.Order).Select(v => v.ServerId).ToList();
        if (ids.Count == 0) return;
        await cloud.Schedule(ids);
        activityLabel.Text = "✓ PROGRAMACIÓN GUARDADA · M3U8 ACTUALIZADA";
    }

    async Task Channel(string action)
    {
        if (action == "state")
        {
            var state = await cloud.ChannelState();
            ApplyState(state);
            return;
        }

        var stateResult = await cloud.ChannelAction(action);
        ApplyState(stateResult);

        foreach (var kv in actionButtons)
        {
            kv.Value.BackColor = GrayButton;
        }

        var activeKey = stateResult.Status switch
        {
            "live" => action == "resume" ? "resume" : "start",
            "paused" => "pause",
            "offair" => "offair",
            _ => "stop"
        };
        if (actionButtons.TryGetValue(activeKey, out var active))
            active.BackColor = Green;

        FlashSuccess(actionButtons[action]);
        activityLabel.Text = action == "offair"
            ? "✓ FUERA DE AIRE enviado. La web pública mostrará el cartel de actualización."
            : $"✓ {action.ToUpperInvariant()} enviado a la web pública.";
    }

    void ApplyState(ChannelState state)
    {
        var name = state.Status switch
        {
            "live" => "EN VIVO",
            "paused" => "PAUSADO",
            "offair" => "FUERA DE AIRE",
            _ => "DETENIDO"
        };
        channelLabel.Text = "ESTADO: " + name;
        channelLabel.ForeColor = state.Status == "live" ? Color.LightGreen : state.Status == "offair" ? Color.Gold : Color.White;

        foreach (var b in actionButtons.Values) b.BackColor = GrayButton;
        var activeKey = state.Status switch
        {
            "live" => "start",
            "paused" => "pause",
            "offair" => "offair",
            _ => "stop"
        };
        if (actionButtons.TryGetValue(activeKey, out var active)) active.BackColor = Green;
    }

    async Task RefreshAll()
    {
        var remote = await cloud.Videos();
        var byId = remote.ToDictionary(v => v.Id);
        foreach (var local in store.Videos.Where(v => v.ServerId > 0))
        {
            if (byId.TryGetValue(local.ServerId, out var remoteVideo))
            {
                local.Title = remoteVideo.Title;
                local.CategoryId = remoteVideo.CategoryId ?? local.CategoryId;
                local.Category = string.IsNullOrWhiteSpace(remoteVideo.Category) ? local.Category : remoteVideo.Category.ToUpperInvariant();
                local.DurationSeconds = remoteVideo.DurationSeconds > 0 ? remoteVideo.DurationSeconds : local.DurationSeconds;
            }
        }
        NormalizeOrder();
        RefreshUi();
        var viewers = await cloud.Viewers();
        viewersLabel.Text = "👥 " + viewers + " VIENDO";
        var storage = await cloud.Storage();
        storageLabel.Text = $"{storage.UsedBytes / 1073741824d:0.00} GB usados · {storage.FreeBytes / 1073741824d:0.00} GB libres";
        connLabel.Text = "CLOUDFLARE R2: ONLINE";
    }

    void StartRefreshTimer()
    {
        refreshTimer?.Dispose();
        refreshTimer = new Timer { Interval = 5000 };
        refreshTimer.Tick += async (_, _) =>
        {
            try
            {
                var state = await cloud.ChannelState();
                ApplyState(state);
                viewersLabel.Text = "👥 " + await cloud.Viewers() + " VIENDO";
                var storage = await cloud.Storage();
                storageLabel.Text = $"{storage.UsedBytes / 1073741824d:0.00} GB usados · {storage.FreeBytes / 1073741824d:0.00} GB libres";
            }
            catch { }
        };
        refreshTimer.Start();
    }

    void NormalizeOrder()
    {
        for (var i = 0; i < store.Videos.Count; i++) store.Videos[i].Order = i;
    }

    void RefreshUi()
    {
        foreach (var pair in categoryGrids)
        {
            var category = pair.Key;
            var g = pair.Value;
            g.Rows.Clear();
            var list = store.Videos.Where(v => v.Category.Equals(category, StringComparison.OrdinalIgnoreCase)).OrderBy(v => v.Order).ToList();
            foreach (var v in list)
            {
                var row = g.Rows.Add(v.Order + 1, v.Title, v.Status, FormatSize(v.SizeBytes), FormatTime(v.DurationSeconds), v.ServerId);
                g.Rows[row].Tag = v;
            }
        }

        programGrid.Rows.Clear();
        foreach (var v in store.Videos.OrderBy(v => v.Order))
        {
            var row = programGrid.Rows.Add(v.Order + 1, v.Title, v.Category, v.Status, FormatTime(v.DurationSeconds));
            programGrid.Rows[row].Tag = v;
        }
    }

    void UpdateActivityFromSelection(DataGridView g)
    {
        var count = g.SelectedRows.Count;
        activityLabel.Text = count > 0 ? $"Seleccionados: {count} · Podés subir varios juntos o cambiar su orden." : "Listo.";
    }

    static string FormatSize(long bytes)
    {
        double n = bytes;
        var units = new[] { "B", "KB", "MB", "GB", "TB" };
        var i = 0;
        while (n >= 1024 && i < units.Length - 1) { n /= 1024; i++; }
        return $"{n:0.##} {units[i]}";
    }

    static string FormatTime(double seconds)
    {
        if (seconds <= 0) return "—";
        var t = TimeSpan.FromSeconds(seconds);
        return t.TotalHours >= 1 ? t.ToString(@"hh:mm:ss") : t.ToString(@"mm:ss");
    }

    static string GetContentType(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".mp4" => "video/mp4",
            ".mov" => "video/quicktime",
            ".m4v" => "video/mp4",
            ".webm" => "video/webm",
            ".mkv" => "video/x-matroska",
            _ => "application/octet-stream"
        };
    }
}
