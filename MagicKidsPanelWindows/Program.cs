using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MagicKidsPanel;

internal static class Program
{
    [STAThread]
    static void Main(){ApplicationConfiguration.Initialize();Application.Run(new MainForm());}
}
sealed class AppConfig{public string VcdnApiKeyProtected{get;set;}="";}
sealed class VideoItem
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string SourcePath{get;set;}="";
    public string Title{get;set;}="";
    public string Category{get;set;}="SERIES";
    public string VcdnId{get;set;}="";
    public string PlaybackUrl{get;set;}="";
    public string Status{get;set;}="EN COLA";
    public double DurationSeconds{get;set;}
    public long SizeBytes{get;set;}
}
sealed class LocalStore{public List<VideoItem> Videos{get;set;}=new();}
sealed class VcdnInit{[JsonPropertyName("upload_id")]public string UploadId{get;set;}="";}
sealed class VcdnComplete{[JsonPropertyName("id")]public string Id{get;set;}="";[JsonPropertyName("status")]public string Status{get;set;}="";[JsonPropertyName("playback_url")]public string PlaybackUrl{get;set;}="";}
sealed class VcdnInfo{[JsonPropertyName("id")]public string Id{get;set;}="";[JsonPropertyName("status")]public string Status{get;set;}="";[JsonPropertyName("duration")]public double Duration{get;set;}[JsonPropertyName("playback_url")]public string PlaybackUrl{get;set;}="";}
sealed class ChannelState{public string Status{get;set;}="stopped";public long Generation{get;set;}public long StartedAt{get;set;}public int CurrentIndex{get;set;}public double PositionSeconds{get;set;}}

static class LocalDb
{
    static string Root=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"MagicKidsPanel");
    static string Cfg=>Path.Combine(Root,"config.json");
    static string Data=>Path.Combine(Root,"library.json");
    static JsonSerializerOptions Opt=>new(){WriteIndented=true,PropertyNameCaseInsensitive=true};
    public static void Ensure()=>Directory.CreateDirectory(Root);
    public static AppConfig Config(){Ensure();try{return JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(Cfg),Opt)??new();}catch{return new();}}
    public static LocalStore Store(){Ensure();try{return JsonSerializer.Deserialize<LocalStore>(File.ReadAllText(Data),Opt)??new();}catch{return new();}}
    public static void Save(AppConfig c){Ensure();File.WriteAllText(Cfg,JsonSerializer.Serialize(c,Opt),Encoding.UTF8);}
    public static void Save(LocalStore s){Ensure();var t=Data+".tmp";File.WriteAllText(t,JsonSerializer.Serialize(s,Opt),Encoding.UTF8);File.Move(t,Data,true);}
    public static string Protect(string v)=>Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(v),null,DataProtectionScope.CurrentUser));
    public static string Unprotect(string v){try{return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(v),null,DataProtectionScope.CurrentUser));}catch{return "";}}
}

sealed class VcdnClient
{
    readonly HttpClient Http;readonly string Key;const string Base="https://cdn.vcdn.me";const int Chunk=16*1024*1024;
    public VcdnClient(HttpClient h,string k){Http=h;Key=k;}
    void Auth(HttpRequestMessage r){r.Headers.Authorization=new AuthenticationHeaderValue("Bearer",Key);r.Headers.TryAddWithoutValidation("X-API-Key",Key);}
    public async Task<VcdnComplete> Upload(string path,string title,IProgress<int> progress,CancellationToken ct)
    {
        var f=new FileInfo(path);
        using var init=new HttpRequestMessage(HttpMethod.Post,Base+"/api/v1/upload/init");Auth(init);
        init.Content=new StringContent(JsonSerializer.Serialize(new{filename=f.Name,title}),Encoding.UTF8,"application/json");
        using var ir=await Http.SendAsync(init,HttpCompletionOption.ResponseHeadersRead,ct);var it=await ir.Content.ReadAsStringAsync(ct);
        if(!ir.IsSuccessStatusCode)throw new Exception("VCDN init: "+it);
        var u=JsonSerializer.Deserialize<VcdnInit>(it)??throw new Exception("Init inválido.");
        using var fs=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read,1024*1024,true);var buf=new byte[Chunk];long sent=0;int n;
        while((n=await fs.ReadAsync(buf.AsMemory(0,buf.Length),ct))>0)
        {
            using var rq=new HttpRequestMessage(HttpMethod.Post,Base+"/api/v1/upload/"+Uri.EscapeDataString(u.UploadId)+"/chunk");Auth(rq);
            var body=new ByteArrayContent(buf,0,n);body.Headers.ContentType=new MediaTypeHeaderValue("application/octet-stream");
            rq.Headers.TryAddWithoutValidation("Content-Range",$"bytes {sent}-{sent+n-1}/{f.Length}");rq.Content=body;
            using var rr=await Http.SendAsync(rq,HttpCompletionOption.ResponseHeadersRead,ct);var txt=await rr.Content.ReadAsStringAsync(ct);
            if(!rr.IsSuccessStatusCode)throw new Exception("VCDN chunk: "+txt);
            sent+=n;progress.Report((int)(sent*100.0/f.Length));
        }
        using var cm=new HttpRequestMessage(HttpMethod.Post,Base+"/api/v1/upload/complete");Auth(cm);
        cm.Content=new StringContent(JsonSerializer.Serialize(new{upload_id=u.UploadId}),Encoding.UTF8,"application/json");
        using var cr=await Http.SendAsync(cm,HttpCompletionOption.ResponseHeadersRead,ct);var ctext=await cr.Content.ReadAsStringAsync(ct);
        if(!cr.IsSuccessStatusCode)throw new Exception("VCDN complete: "+ctext);
        return JsonSerializer.Deserialize<VcdnComplete>(ctext)??throw new Exception("Complete inválido.");
    }
    public async Task<VcdnInfo> Info(string id,CancellationToken ct)
    {
        using var rq=new HttpRequestMessage(HttpMethod.Get,Base+"/api/v1/videos/"+Uri.EscapeDataString(id));Auth(rq);
        using var r=await Http.SendAsync(rq,HttpCompletionOption.ResponseHeadersRead,ct);var t=await r.Content.ReadAsStringAsync(ct);
        if(!r.IsSuccessStatusCode)throw new Exception(t);return JsonSerializer.Deserialize<VcdnInfo>(t)??new();
    }
    public async Task WaitReady(string id,Action<VcdnInfo> update,CancellationToken ct)
    {
        for(var i=0;i<120;i++){var v=await Info(id,ct);update(v);if(v.Status.Equals("ready",StringComparison.OrdinalIgnoreCase))return;if(v.Status.Equals("failed",StringComparison.OrdinalIgnoreCase))throw new Exception("VCDN falló al procesar.");await Task.Delay(3000,ct);}throw new TimeoutException("VCDN tardó demasiado.");
    }
}

sealed class Cloud
{
    readonly HttpClient Http;const string Base="https://uifchrnvigkzantaehgz.supabase.co/functions/v1/mk-vcdn-channel";const string Token="vkqjFnisY5V-CmZMYsAbi1jvWc-8CG9rgJHxxme5nb6O7r4qV-g5RJKGuv7o_KWu";
    public Cloud(HttpClient h){Http=h;}public string M3u=>$"{Base}/magic-kids.m3u8";
    async Task<JsonElement> Post(string path,object body,CancellationToken ct){using var rq=new HttpRequestMessage(HttpMethod.Post,Base+path);rq.Headers.Add("X-MK-Control",Token);rq.Content=new StringContent(JsonSerializer.Serialize(body),Encoding.UTF8,"application/json");using var r=await Http.SendAsync(rq,HttpCompletionOption.ResponseHeadersRead,ct);var t=await r.Content.ReadAsStringAsync(ct);if(!r.IsSuccessStatusCode)throw new Exception(t);using var d=JsonDocument.Parse(t);return d.RootElement.Clone();}
    public Task Upsert(VideoItem v,CancellationToken ct)=>Post("/admin/video/upsert",new{title=v.Title,category=v.Category,vcdnId=v.VcdnId,playbackUrl=v.PlaybackUrl,durationSeconds=v.DurationSeconds,sizeBytes=v.SizeBytes,status=v.Status},ct);
    public Task Schedule(List<VideoItem> vs,CancellationToken ct)=>Post("/admin/schedule",new{items=vs.Where(v=>!string.IsNullOrWhiteSpace(v.VcdnId)).Select(v=>new{videoId=v.Id}).ToArray()},ct);
    public async Task<ChannelState> Channel(string action,CancellationToken ct){var d=await Post("/admin/channel",new{action},ct);return JsonSerializer.Deserialize<ChannelState>(d.GetProperty("state").GetRawText(),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??new();}
    public async Task<int> Viewers(CancellationToken ct){try{var t=await Http.GetStringAsync("https://uifchrnvigkzantaehgz.supabase.co/functions/v1/magic-kids-api/viewers/count?mk="+DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),ct);using var d=JsonDocument.Parse(t);return d.RootElement.TryGetProperty("count",out var c)?c.GetInt32():0;}catch{return 0;}}
}

sealed class MainForm:Form
{
    readonly HttpClient Http=new(){Timeout=TimeSpan.FromMinutes(30)};readonly AppConfig Config;readonly LocalStore Store;readonly Cloud Cloud;VcdnClient? Vcdn;readonly TabControl Tabs=new();readonly ListBox Queue=new();readonly Label State=new();readonly Label Viewers=new();readonly Label M3u=new();readonly Label Info=new();CancellationTokenSource? UploadCts;
    static readonly Color Bg=Color.FromArgb(8,4,31),Card=Color.FromArgb(16,8,52),Purple=Color.FromArgb(116,54,255),Green=Color.FromArgb(31,165,93),Red=Color.FromArgb(185,44,55),Amber=Color.FromArgb(143,102,20);
    public MainForm(){Config=LocalDb.Config();Store=LocalDb.Store();Cloud=new Cloud(Http);Text="MAGIC KIDS — PANEL PRIVADO";StartPosition=FormStartPosition.CenterScreen;Width=1180;Height=760;MinimumSize=new Size(920,620);BackColor=Bg;ForeColor=Color.White;Font=new Font("Segoe UI",9);Build();}
    Button B(string t,Color c,Func<Task> a){var b=new Button{Text=t,BackColor=c,ForeColor=Color.White,FlatStyle=FlatStyle.Flat,Width=130,Height=40,Margin=new Padding(4)};b.FlatAppearance.BorderSize=0;b.Click+=async(_,_)=>{b.Enabled=false;try{await a();}catch(Exception e){MessageBox.Show(e.Message,"MAGIC KIDS",MessageBoxButtons.OK,MessageBoxIcon.Error);}finally{b.Enabled=true;}};return b;}
    void Build()
    {
        var root=new TableLayoutPanel{Dock=DockStyle.Fill,RowCount=3,ColumnCount=1,BackColor=Bg};root.RowStyles.Add(new RowStyle(SizeType.Absolute,60));root.RowStyles.Add(new RowStyle(SizeType.Absolute,88));root.RowStyles.Add(new RowStyle(SizeType.Percent,100));Controls.Add(root);
        var h=new Panel{Dock=DockStyle.Fill};h.Controls.Add(new Label{Text="MAGIC KIDS",ForeColor=Color.FromArgb(255,210,27),Font=new Font("Segoe UI",20,FontStyle.Bold),AutoSize=true,Location=new Point(18,6)});h.Controls.Add(new Label{Text="PANEL PRIVADO · VCDN · HLS · SIN PIN",ForeColor=Color.LightGray,AutoSize=true,Location=new Point(20,37)});root.Controls.Add(h,0,0);
        var bar=new FlowLayoutPanel{Dock=DockStyle.Fill,BackColor=Card,Padding=new Padding(12,8,12,8),WrapContents=false};bar.Controls.Add(B("▶ INICIAR",Green,()=>Channel("start")));bar.Controls.Add(B("■ STOP",Red,()=>Channel("stop")));bar.Controls.Add(B("▣ FUERA DE AIRE",Color.FromArgb(53,44,80),()=>Channel("offair")));bar.Controls.Add(B("↻ REINICIAR",Purple,()=>Channel("restart")));bar.Controls.Add(B("Ⅱ PAUSAR",Amber,()=>Channel("pause")));bar.Controls.Add(B("▶ REANUDAR",Green,()=>Channel("resume")));State.Text="ESTADO: DETENIDO";State.Margin=new Padding(18,15,0,0);bar.Controls.Add(State);Viewers.Text="👥 0 VIENDO";Viewers.Margin=new Padding(18,15,0,0);bar.Controls.Add(Viewers);root.Controls.Add(bar,0,1);root.Controls.Add(Tabs,0,2);
        AddTab("TANDAS");AddTab("SERIES");AddTab("PELICULAS");AddTab("TODOS");BuildProgramming();BuildSettings();Load+=async(_,_)=>await Startup();
    }
    async Task Startup(){var n=await Cloud.Viewers(CancellationToken.None);Viewers.Text="👥 "+n+" VIENDO";Refresh();}
    void AddTab(string cat)
    {
        var p=new TabPage(cat){BackColor=Bg,ForeColor=Color.White};var top=new FlowLayoutPanel{Dock=DockStyle.Top,Height=50};top.Controls.Add(B("＋ AGREGAR VIDEOS",Purple,()=>Add(cat)));top.Controls.Add(B("↥ SUBIR VARIOS",Green,()=>Upload(cat)));top.Controls.Add(B("↶ SUBIR",Color.FromArgb(56,45,90),()=>Move(cat,-1)));top.Controls.Add(B("↷ BAJAR",Color.FromArgb(56,45,90),()=>Move(cat,1)));
        var g=new DataGridView{Dock=DockStyle.Fill,AutoGenerateColumns=false,BackgroundColor=Bg,ForegroundColor=Color.White,GridColor=Color.FromArgb(45,31,90),AllowUserToAddRows=false,SelectionMode=DataGridViewSelectionMode.FullRowSelect,MultiSelect=true,ReadOnly=true,RowHeadersVisible=false,Tag=cat};g.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Título",DataPropertyName=nameof(VideoItem.Title),AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill});g.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="Estado",DataPropertyName=nameof(VideoItem.Status),Width=120});g.Columns.Add(new DataGridViewTextBoxColumn{HeaderText="VCDN",DataPropertyName=nameof(VideoItem.VcdnId),Width=130});p.Controls.Add(g);p.Controls.Add(top);p.Enter+=(_,_)=>Bind(g,cat);Tabs.TabPages.Add(p);Bind(g,cat);
    }
    void Bind(DataGridView g,string cat){g.DataSource=null;g.DataSource=cat=="TODOS"?Store.Videos:Store.Videos.Where(v=>v.Category.Equals(cat,StringComparison.OrdinalIgnoreCase)).ToList();}
    async Task Add(string cat){if(cat=="TODOS")cat="SERIES";using var d=new OpenFileDialog{Multiselect=true,Filter="Videos|*.mp4;*.mkv;*.mov;*.webm;*.avi|Todos|*.*"};if(d.ShowDialog()!=DialogResult.OK)return;foreach(var p in d.FileNames)Store.Videos.Add(new VideoItem{SourcePath=p,Title=Path.GetFileNameWithoutExtension(p),Category=cat,SizeBytes=new FileInfo(p).Length});LocalDb.Save(Store);Refresh();await Task.CompletedTask;}
    async Task Upload(string cat){var key=LocalDb.Unprotect(Config.VcdnApiKeyProtected);if(string.IsNullOrWhiteSpace(key)){Tabs.SelectedTab=Tabs.TabPages[Tabs.TabPages.Count-1];throw new Exception("Primero pegá tu API Key de VCDN en AJUSTES.");}Vcdn=new VcdnClient(Http,key);var list=Store.Videos.Where(v=>v.Category.Equals(cat,StringComparison.OrdinalIgnoreCase)&&File.Exists(v.SourcePath)&&string.IsNullOrWhiteSpace(v.VcdnId)).Take(100).ToList();if(!list.Any()){MessageBox.Show("No hay videos en cola en esta sección.");return;}UploadCts?.Cancel();UploadCts=new();var ct=UploadCts.Token;var sem=new SemaphoreSlim(3);var tasks=list.Select(async v=>{await sem.WaitAsync(ct);try{await UploadOne(v,ct);}finally{sem.Release();}});await Task.WhenAll(tasks);await Sync();}
    async Task UploadOne(VideoItem v,CancellationToken ct){v.Status="SUBIENDO";Refresh();var p=new Progress<int>(x=>{v.Status="SUBIENDO "+x+"%";if(x%5==0)BeginInvoke(Refresh);});var done=await Vcdn!.Upload(v.SourcePath,v.Title,p,ct);v.VcdnId=done.Id;v.PlaybackUrl=done.PlaybackUrl;v.Status=done.Status;await Vcdn.WaitReady(v.VcdnId,i=>{v.Status=i.Status.ToUpperInvariant();if(!string.IsNullOrWhiteSpace(i.PlaybackUrl))v.PlaybackUrl=i.PlaybackUrl;if(i.Duration>0)v.DurationSeconds=i.Duration;BeginInvoke(Refresh);},ct);v.Status="LISTO";await Cloud.Upsert(v,ct);}
    async Task Sync(){await Cloud.Schedule(Store.Videos,CancellationToken.None);LocalDb.Save(Store);Refresh();Info.Text="✓ Programación sincronizada";}
    async Task Move(string cat,int dir){var grid=Tabs.SelectedTab?.Controls.OfType<DataGridView>().FirstOrDefault();if(grid==null)return;var selected=grid.SelectedRows.Cast<DataGridViewRow>().Select(r=>r.DataBoundItem as VideoItem).Where(v=>v!=null).ToList();foreach(var item in selected){var i=Store.Videos.IndexOf(item!);var j=i+dir;if(j>=0&&j<Store.Videos.Count)(Store.Videos[i],Store.Videos[j])=(Store.Videos[j],Store.Videos[i]);}await Sync();}
    async Task Channel(string action){var s=await Cloud.Channel(action,CancellationToken.None);State.Text="ESTADO: "+s.Status.ToUpperInvariant();Info.Text=action=="offair"?"FUERA DE AIRE: actualizando programación":"✓ "+action.ToUpperInvariant();}
    void BuildProgramming()
    {
        var p=new TabPage("PROGRAMACIÓN"){BackColor=Bg,ForeColor=Color.White};var top=new FlowLayoutPanel{Dock=DockStyle.Top,Height=48};top.Controls.Add(B("↶ SUBIR",Purple,()=>MoveQueue(-1)));top.Controls.Add(B("↷ BAJAR",Purple,()=>MoveQueue(1)));top.Controls.Add(B("💾 GUARDAR",Green,Sync));top.Controls.Add(B("▣ FUERA DE AIRE",Color.FromArgb(53,44,80),()=>Channel("offair")));p.Controls.Add(top);Queue.Dock=DockStyle.Fill;Queue.BackColor=Card;Queue.ForeColor=Color.White;Queue.SelectionMode=SelectionMode.MultiExtended;p.Controls.Add(Queue);var btm=new Panel{Dock=DockStyle.Bottom,Height=62};btm.Controls.Add(new Label{Text="M3U8 PERMANENTE:",ForeColor=Color.FromArgb(255,210,27),AutoSize=true,Location=new Point(0,9)});M3u.Text=Cloud.M3u;M3u.ForeColor=Color.LightGray;M3u.Location=new Point(125,8);M3u.Width=720;btm.Controls.Add(M3u);var copy=B("COPIAR",Purple,async()=>{Clipboard.SetText(Cloud.M3u);await Task.CompletedTask;});copy.Location=new Point(850,4);btm.Controls.Add(copy);btm.Controls.Add(Info);p.Controls.Add(btm);Tabs.TabPages.Add(p);
    }
    void BuildSettings()
    {
        var p=new TabPage("AJUSTES"){BackColor=Bg,ForeColor=Color.White};var box=new Panel{Dock=DockStyle.Fill,Padding=new Padding(26)};box.Controls.Add(new Label{Text="VCDN — API Key",ForeColor=Color.FromArgb(255,210,27),Font=new Font("Segoe UI",14,FontStyle.Bold),AutoSize=true,Location=new Point(26,24)});var key=new TextBox{Width=600,UseSystemPasswordChar=true,Location=new Point(26,72),Text=LocalDb.Unprotect(Config.VcdnApiKeyProtected)};box.Controls.Add(key);var save=B("GUARDAR CLAVE",Green,async()=>{Config.VcdnApiKeyProtected=LocalDb.Protect(key.Text.Trim());LocalDb.Save(Config);MessageBox.Show("Clave VCDN guardada de forma cifrada.","MAGIC KIDS");await Task.CompletedTask;});save.Location=new Point(26,110);box.Controls.Add(save);box.Controls.Add(new Label{Text="No usa PIN ni contraseña. La API Key solo sirve para VCDN y se cifra con Windows.",ForeColor=Color.LightGray,AutoSize=true,Location=new Point(26,165)});p.Controls.Add(box);Tabs.TabPages.Add(p);
    }
    async Task MoveQueue(int dir){var sel=Queue.SelectedIndices.Cast<int>().OrderBy(i=>dir>0?-i:i).ToList();var ready=Store.Videos.Where(v=>!string.IsNullOrWhiteSpace(v.VcdnId)).ToList();foreach(var i in sel){var j=i+dir;if(i<0||i>=ready.Count||j<0||j>=ready.Count)continue;var a=Store.Videos.IndexOf(ready[i]);var b=Store.Videos.IndexOf(ready[j]);(Store.Videos[a],Store.Videos[b])=(Store.Videos[b],Store.Videos[a]);}await Sync();}
    void Refresh(){Queue.Items.Clear();foreach(var v in Store.Videos.Where(v=>!string.IsNullOrWhiteSpace(v.VcdnId)))Queue.Items.Add(v.Title);foreach(TabPage p in Tabs.TabPages)foreach(Control c in p.Controls)if(c is DataGridView g&&g.Tag is string cat)Bind(g,cat);}
}
